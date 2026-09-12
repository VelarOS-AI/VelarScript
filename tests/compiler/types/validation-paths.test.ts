import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

async function runtime(source: string): Promise<Record<string, {parse(value: unknown): unknown}>> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  return import(`data:text/javascript,${encodeURIComponent(result.code!)}`);
}
function failure(type: {parse(value: unknown): unknown}, value: unknown): {path: {kind: string; name?: string; index?: number}[]; field: string | null; message: string} {
  try { type.parse(value); } catch (error) {
    assert.equal((error as Error).name, "ValidationError");
    return error as ReturnType<typeof failure>;
  }
  assert.fail("expected a structural validation failure");
}
const field = (name: string) => ({kind: "field", name});

test("validation paths locate fields, containers and collection roles without user conversion", async () => {
  const types = await runtime(`export type Item:\n    name: string\nexport type Dataset:\n    items: List<Item>\nexport type Entries = Map<Item, Item>\nexport type Values = Set<Item>\nexport type Dynamic = Record<Item>\n`);
  const bad = {name: 7, toString() { throw new Error("user conversion"); }};
  assert.deepEqual(failure(types.Dataset!, {items: [{name: "ok"}, bad]}).path, [field("items"), {kind: "listIndex", index: 1}, field("name")]);
  assert.deepEqual(failure(types.Dataset!, {items: new Set()}).path, [field("items")]);
  assert.deepEqual(failure(types.Dataset!, {}).path, [field("items")]);
  assert.deepEqual(failure(types.Entries!, new Map([[bad, {name: "ok"}]])).path, [{kind: "mapKey", index: 0}, field("name")]);
  assert.deepEqual(failure(types.Entries!, new Map([[{name: "ok"}, bad]])).path, [{kind: "mapValue", index: 0}, field("name")]);
  assert.deepEqual(failure(types.Values!, new Set([bad])).path, [{kind: "setElement", index: 0}, field("name")]);
  assert.deepEqual(failure(types.Dynamic!, {dynamicKey: bad}).path, [{kind: "recordEntry", index: 0}, field("name")]);
  let calls = 0;
  const accessor = {get name() { calls++; return "ok"; }};
  assert.deepEqual(failure(types.Dataset!, {items: [accessor]}).path, [field("items"), {kind: "listIndex", index: 0}, field("name")]);
  assert.equal(calls, 0);
});

test("aliases, inherited fields and generic argument plans retain nested paths", async () => {
  const types = await runtime(`type Item:\n    name: string\ntype Alias = Item\ntype Base:\n    item: Alias\nexport type Derived extends Base:\n    count: number\ntype Box<T>:\n    inner: T\nexport type Nested = Box<List<Alias>>\n`);
  assert.deepEqual(failure(types.Derived!, {item: {name: 3}, count: 1}).path, [field("item"), field("name")]);
  assert.deepEqual(failure(types.Nested!, {inner: [{name: 3}]}).path, [field("inner"), {kind: "listIndex", index: 0}, field("name")]);
});

test("union diagnostics follow a proven discriminant and otherwise retain the union location", async () => {
  const types = await runtime(`enum Kind:\n    left\n    right\ntype Left:\n    kind: Kind.left\n    text: string\ntype Right:\n    kind: Kind.right\n    count: number\nexport type Tagged = Left | Right\ntype Textual:\n    text: string\ntype Counted:\n    count: number\nexport type Untagged = Textual | Counted\nexport type Mixed = Left | Counted\n`);
  assert.deepEqual(failure(types.Tagged!, {kind: "left", text: 2}).path, [field("text")]);
  assert.deepEqual(failure(types.Tagged!, {kind: "other", text: 2}).path, []);
  assert.deepEqual(failure(types.Mixed!, {kind: "left", text: 2}).path, []);
  assert.deepEqual(failure(types.Untagged!, {text: 2}).path, []);
});

test("diagnostic budgets preserve a bounded readonly prefix and explicitly mark truncation", async () => {
  const types = await runtime(`export type Link:\n    next: Link?\nexport type Numbers = List<number>\n`);
  let deep: unknown = {next: 3};
  for (let index = 0; index < 80; index++) deep = {next: deep};
  const depth = failure(types.Link!, deep);
  assert.equal(depth.path.length, 64);
  assert.equal(depth.path[63]!.kind, "truncated");
  assert.equal(depth.path.length, 64);
  assert.ok(depth.path.slice(0, -1).every((segment) => segment.kind === "field"));
  assert.match(depth.message, /diagnostic truncated/u);
  assert.ok(depth.message.length <= 4096);
  const wide = failure(types.Numbers!, [...Array(5000).fill(1), "bad"]);
  assert.equal(wide.path.at(-1)!.kind, "truncated");
  assert.ok(wide.path.length <= 64);
  const cycle: {next?: unknown} = {};
  cycle.next = cycle;
  assert.deepEqual(failure(types.Link!, cycle).path, [field("next")]);
});

test("manual errors have root paths and long messages exhaust the diagnostic budget", async () => {
  const result = compile('export def manual() -> ValidationError:\n    return ValidationError("manual")\n');
  assert.deepEqual(result.diagnostics, []);
  const module = await import(`data:text/javascript,${encodeURIComponent(result.code!)}`);
  assert.deepEqual(module.manual().path, []);
  const name = "a".repeat(5000);
  const types = await runtime(`export type Long:\n    ${name}: string\n`);
  const error = failure(types.Long!, {});
  assert.ok(error.message.length <= 4096);
  assert.equal(error.path.at(-1)!.kind, "truncated");
  assert.equal(error.field, null);
});

test("path normalization captures host operations and never evaluates segment accessors", async () => {
  const { VELAR_TYPE_VALIDATION_MODULE_SOURCE } = await import("@velarscript/compiler/extension");
  const helpers = await import(`data:text/javascript,${encodeURIComponent(VELAR_TYPE_VALIDATION_MODULE_SOURCE)}`);
  let reads = 0;
  assert.throws(() => helpers.validationPath([{get kind() { reads++; return "field"; }, name: "x"}]));
  assert.throws(() => helpers.validationPath([{kind: "field", get name() { reads++; return "x"; }}]));
  assert.equal(reads, 0);
  for (const index of [-1, 0.5, NaN, Infinity, 9007199254740992, "0"]) {
    assert.throws(() => helpers.validationPath([{kind: "listIndex", index}]));
  }
  assert.throws(() => helpers.validationPath([{kind: "truncated"}, field("x")]));
  const original = Number.isSafeInteger;
  try {
    Number.isSafeInteger = () => { throw new Error("replacement must not run"); };
    assert.deepEqual(helpers.validationPath([{kind: "mapValue", index: 0}]), [{kind: "mapValue", index: 0}]);
  } finally { Number.isSafeInteger = original; }
  const source = [field("before")];
  const copied = helpers.validationPath(source);
  source[0]!.name = "after";
  source.push(field("extra"));
  assert.deepEqual(copied, [field("before")]);
});
