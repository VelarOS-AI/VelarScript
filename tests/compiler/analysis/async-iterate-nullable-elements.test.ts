import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * AS-D1: an asynchronous `@iterate:` spends `null` on exhaustion, so a stream
 * whose elements may themselves be null cannot be written. It used to compile
 * clean and drop data at runtime — the first null element ended the loop and
 * every element behind it was never delivered.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

const nullElement = `
class Source:
    let sent: number = 0

    @iterate:
        self.sent += 1
        if self.sent > 3:
            return null
        const value: string? = self.sent == 2 ? null : f"item{self.sent}"
        return value

@main:
    const source = Source()
    async for value in source:
        print(f"got {value}")
`;

test("[AS-D1] an asynchronous '@iterate' refuses an element that may be null", () => {
  assert.deepEqual(messages(nullElement), [
    "VEL4041 An asynchronous '@iterate' answers null to say the stream is exhausted, so an element cannot be null too;"
    + " this return answers string?. Answer the element without the optional, or wrap it — 'return {value: element}' —"
    + " so exhaustion stays the only null",
  ]);
});

test("[AS-D1] the exhaustion answer and a non-optional element stay legal", () => {
  assert.deepEqual(messages(`
class Source:
    let sent: number = 0

    @iterate:
        self.sent += 1
        if self.sent > 3:
            return null
        return f"item{self.sent}"

@main:
    const source = Source()
    async for value in source:
        print(f"got {value}")
`), []);
});

test("[AS-D1] a nullable element wrapped in a record is what the report asks for", () => {
  assert.deepEqual(messages(`
type Cell:
    value: string?

class Source:
    let sent: number = 0

    @iterate:
        self.sent += 1
        if self.sent > 3:
            return null
        const cell: Cell = {value: self.sent == 2 ? null : f"item{self.sent}"}
        return cell

@main:
    const source = Source()
    async for cell in source:
        print(f"got {cell.value ?? "NULL"}")
`), []);
});

test("[AS-D1] the synchronous form is untouched — its answer is a collection", () => {
  assert.deepEqual(messages(`
class Bag:
    let items: List<string?> = ["a", null]

    @iterate:
        return self.items

@main:
    for item in Bag():
        print(f"{item ?? "NULL"}")
`), []);
});
