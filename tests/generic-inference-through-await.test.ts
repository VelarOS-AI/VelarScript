import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";

/**
 * D114 item ① follow-up: `await` and `try` are transparent to the position.
 * Neither adds a position of its own — they pass the enclosing one through, so
 * the four-step rule of charter section 7 reaches the call written under them.
 * `await` hands its operand `Promise` of what the position expects and `try`
 * hands its operand the non-optional part; parentheses carry no node at all.
 */

const loadAll = `
async def loadAll<T>(url: string) -> List<T>:
    return []
`.trimStart();

const empty = `
def empty<T>() -> List<T>:
    return []
`.trimStart();

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function webMessages(source: string): readonly string[] {
  return compile(source.trimStart(), { path: "probe.vel", extensions: [webCompilerExtension] })
    .diagnostics.map((item) => `${item.code} ${item.message}`);
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code ?? "",
    timeout: 20_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

test("[D114 ①] a position reaches a generic call through 'await'", () => {
  assert.deepEqual(messages(`${loadAll}
async def main():
    const rows: List<string> = await loadAll("u")
    print(f"{rows.size}")

await main()
`), []);

  assert.deepEqual(messages(`${loadAll}
async def use(values: List<string>) -> number:
    return values.size

async def main():
    const count = await use(await loadAll("u"))
    print(f"{count}")

await main()
`), []);

  assert.deepEqual(messages(`${loadAll}
async def names() -> List<string>:
    return await loadAll("u")

print(f"{(await names()).size}")
`), []);
});

test("[D114 ①] a position reaches a generic call through 'try', and through 'try await'", () => {
  assert.deepEqual(messages(`${empty}
const names: List<string>? = try empty()
print(f"{names == null}")
`), []);

  assert.deepEqual(messages(`${loadAll}
async def main():
    const rows: List<string>? = try await loadAll("u")
    print(f"{rows == null}")

await main()
`), []);

  // Parentheses carry no node of their own, so the position passes through
  // them without any rule saying so.
  assert.deepEqual(messages(`${loadAll}
async def main():
    const rows: List<string> = (await loadAll("u"))
    print(f"{rows.size}")

await main()
`), []);
});

test("[D114 ①] 'await' passes through every contextual position section 8 names", () => {
  assert.deepEqual(messages(`${loadAll}
type Rows:
    values: List<string>

async def main():
    const record: Rows = {values: await loadAll("u")}
    print(f"{record.values.size}")

await main()
`), []);

  // The Web positions: `state` with an annotation, and a JSX attribute. A
  // `resource` initializer is a load rather than an awaited value — charter
  // section 15 writes it without `await` — so there is no `await` form of it
  // to test; the plain `resource` position is S1's own and is covered there.
  assert.deepEqual(webMessages(`${loadAll}
export component Panel(url: string):
    state names: List<string> = []

    @mounted:
        names = await loadAll(url)

    return <p>{f"{names.size}"}</p>
`), []);

  assert.deepEqual(webMessages(`${loadAll}
component Row(values: List<string>):
    return <li>{f"{values.size}"}</li>

export component Panel(url: string):
    resource rows: List<string> = loadAll(url)

    return <ul><Row values={rows.value ?? []} /></ul>
`), []);
});

test("[D114 ①] 'await' says nothing where the position says nothing", () => {
  // Section 8 reads the same channel, so an empty collection under `await`
  // must go on saying exactly what it said: the await refuses a List, and the
  // element type is not settled by the annotation on the other side.
  assert.deepEqual(messages(`
async def main():
    const empty: List<number> = await []
    print(f"{empty.size}")

await main()
`), [
    "VEL4001 Cannot await List<unknown>",
    "VEL4001 Cannot assign unknown to List<number>; a boundary value stays unknown until validated at the edge — declare a type naming the shape you rely on and call 'Type.parse' on the value",
  ]);

  // With no position at all the parameter is still unknown, exactly as it is
  // without the `await`.
  assert.deepEqual(messages(`${loadAll}
async def main():
    const rows = await loadAll("u")
    print(f"{rows.size}")

await main()
`), []);
});

test("[D114 ①] seeding through 'await' is erased, and the program runs", () => {
  const generic = compile(`${loadAll}
async def main():
    const rows: List<string> = await loadAll("u")
    print(f"{rows.size}")

await main()
`.trimStart());
  const concrete = compile(`
async def loadAll(url: string) -> List<string>:
    return []

async def main():
    const rows: List<string> = await loadAll("u")
    print(f"{rows.size}")

await main()
`.trimStart());
  assert.deepEqual(generic.diagnostics, []);
  assert.deepEqual(concrete.diagnostics, []);
  assert.equal(generic.code, concrete.code);

  assert.equal(run(`
async def loadAll<T>(url: string, seed: List<T>) -> List<T>:
    return seed

async def main():
    const rows: List<string>? = try await loadAll("u", ["a", "b"])
    print(f"{(rows ?? []).join(",")}")

await main()
`), "a,b\n");
});
