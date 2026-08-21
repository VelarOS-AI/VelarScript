import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@velarscript/compiler";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";

// closeout co-7: what a request body actually costs between the socket and the
// handler. Deliberately not a *.test.ts file — the gate globs tests/*.test.ts,
// and a benchmark has no business reddening a gate on a loaded machine.
//
//   node tests/parse-copy.bench.ts
//
// The question co-7 posed was whether a typed read may skip D90 rule R5's copy,
// since the decode hands it a brand new, privately held object. The copy cannot
// simply be dropped — it is what rebuilds the value from the declared fields, so
// dropping it hands handlers client-controlled extra keys. Two rebuilds run on
// that path, though, and only one of them survives: the decode rebuilds the host
// parser's tree into owned data, and R5's copy then discards that rebuild and
// builds its own. `__velarJsonParseTyped` is the entry that skips the discarded
// one; `Json.parse + Type.parse` against `typed decode` below is what it saves.
//
// `fused*` is the road not taken: a hand-written stand-in for a generated entry
// that fused the validate walk and the build walk, kept here because it prices
// that mechanism against the one that shipped.

const SOURCE = `
export type Small:
    id: string
    name: string
    count: number
    active: bool

export type Tag:
    key: string
    value: string

export type Item:
    sku: string
    quantity: number
    tags: List<Tag>

export type Order:
    id: string
    customer: string
    items: List<Item>
    notes: List<string>
`;

interface RuntimeType {
  is(value: unknown): boolean;
  parse(value: unknown): unknown;
}

const directory = await mkdtemp(join(tmpdir(), "velar-parse-bench-"));
try {
  const compiled = compile(SOURCE.trimStart());
  assert.deepEqual(compiled.diagnostics, [], JSON.stringify(compiled.diagnostics));
  assert.ok(compiled.code !== null);
  await writeFile(join(directory, "types.mjs"), compiled.code, "utf8");

  // A second module, compiled the same way, reaches __velarJsonParse through
  // the Json namespace so the JSON-decode leg can be priced on its own.
  const jsonCompiled = compile(`
export def parseJson(text: string) -> unknown:
    return Json.parse(text)
`.trimStart());
  assert.deepEqual(jsonCompiled.diagnostics, [], JSON.stringify(jsonCompiled.diagnostics));
  assert.ok(jsonCompiled.code !== null);
  await writeFile(join(directory, "json.mjs"), jsonCompiled.code, "utf8");

  const wanted = new Set<string>(["velar/json"]);
  const visit = (name: string): void => {
    for (const dependency of standardModuleDependencies(name) ?? []) {
      if (wanted.has(dependency)) continue;
      wanted.add(dependency);
      visit(dependency);
    }
  };
  visit("velar/json");
  const root = join(directory, "node_modules", "velar");
  await mkdir(root, {recursive: true});
  const exports_: Record<string, string> = {};
  for (const name of wanted) {
    const moduleSource = standardModuleSource(name);
    assert.ok(moduleSource, `missing standard module ${name}`);
    const short = name.slice("velar/".length);
    exports_[`./${short}`] = `./${short}.js`;
    // The typed decode is module-internal — it takes the Type so a value that
    // skipped the owned-data rebuild cannot reach anyone else — so the benchmark
    // exports it from its own copy of the module to price it directly.
    const exported = name === "velar/json" ? `${moduleSource}\nexport {__velarJsonParseTyped as parseTyped};\n` : moduleSource;
    await writeFile(join(root, `${short}.js`), exported, "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");

  const types = await import(pathToFileURL(join(directory, "types.mjs")).href) as Record<string, RuntimeType>;
  const {parseJson} = await import(pathToFileURL(join(directory, "json.mjs")).href) as {parseJson(text: string): unknown};
  const {parseTyped} = await import(pathToFileURL(join(root, "json.js")).href) as {parseTyped(Type: RuntimeType, text: string, name?: string): unknown};

  const order: Record<string, unknown> = {id: "o-1", customer: "acme", items: [] as unknown[], notes: ["first", "second", "third"]};
  for (let index = 0; index < 20; index += 1) {
    (order.items as unknown[]).push({sku: `sku-${index}`, quantity: index, tags: [{key: "a", value: "1"}, {key: "b", value: "2"}]});
  }
  const bodies = {
    small: JSON.stringify({id: "abc-123", name: "widget", count: 42, active: true}),
    order: JSON.stringify(order),
  };

  // The fused ceiling. Written straight-line and unrolled per field, because
  // that is the shape the emitter generates — a table-driven walker measures
  // its own abstraction, not the mechanism. Each returns FAILED rather than
  // throwing, because the real entry would fall back to the existing
  // check-then-explain path for the error message.
  const FAILED = Symbol("failed");
  const plain = (value: unknown): boolean => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  };
  const define = (target: object, name: string, value: unknown): void => {
    Object.defineProperty(target, name, {value, writable: true, enumerable: true, configurable: true});
  };
  const fusedList = (value: unknown, item: (element: unknown) => unknown): unknown => {
    if (!Array.isArray(value)) return FAILED;
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      const element = item(descriptor?.value);
      if (element === FAILED) return FAILED;
      result[index] = element;
    }
    return result;
  };
  const fusedText = (value: unknown): unknown => typeof value === "string" ? value : FAILED;
  const fusedTag = (value: unknown): unknown => {
    if (!plain(value)) return FAILED;
    const result = {};
    const key = Object.getOwnPropertyDescriptor(value, "key");
    if (!(key?.enumerable && "value" in key && typeof key.value === "string")) return FAILED;
    define(result, "key", key.value);
    const item = Object.getOwnPropertyDescriptor(value, "value");
    if (!(item?.enumerable && "value" in item && typeof item.value === "string")) return FAILED;
    define(result, "value", item.value);
    return result;
  };
  const fusedItem = (value: unknown): unknown => {
    if (!plain(value)) return FAILED;
    const result = {};
    const sku = Object.getOwnPropertyDescriptor(value, "sku");
    if (!(sku?.enumerable && "value" in sku && typeof sku.value === "string")) return FAILED;
    define(result, "sku", sku.value);
    const quantity = Object.getOwnPropertyDescriptor(value, "quantity");
    if (!(quantity?.enumerable && "value" in quantity && typeof quantity.value === "number")) return FAILED;
    define(result, "quantity", quantity.value);
    const tags = Object.getOwnPropertyDescriptor(value, "tags");
    if (!(tags?.enumerable && "value" in tags)) return FAILED;
    const copiedTags = fusedList(tags.value, fusedTag);
    if (copiedTags === FAILED) return FAILED;
    define(result, "tags", copiedTags);
    return result;
  };
  const fusedOrder = (value: unknown): unknown => {
    if (!plain(value)) return FAILED;
    const result = {};
    const id = Object.getOwnPropertyDescriptor(value, "id");
    if (!(id?.enumerable && "value" in id && typeof id.value === "string")) return FAILED;
    define(result, "id", id.value);
    const customer = Object.getOwnPropertyDescriptor(value, "customer");
    if (!(customer?.enumerable && "value" in customer && typeof customer.value === "string")) return FAILED;
    define(result, "customer", customer.value);
    const items = Object.getOwnPropertyDescriptor(value, "items");
    if (!(items?.enumerable && "value" in items)) return FAILED;
    const copiedItems = fusedList(items.value, fusedItem);
    if (copiedItems === FAILED) return FAILED;
    define(result, "items", copiedItems);
    const notes = Object.getOwnPropertyDescriptor(value, "notes");
    if (!(notes?.enumerable && "value" in notes)) return FAILED;
    const copiedNotes = fusedList(notes.value, fusedText);
    if (copiedNotes === FAILED) return FAILED;
    define(result, "notes", copiedNotes);
    return result;
  };
  const fusedSmall = (value: unknown): unknown => {
    if (!plain(value)) return FAILED;
    const result = {};
    const id = Object.getOwnPropertyDescriptor(value, "id");
    if (!(id?.enumerable && "value" in id && typeof id.value === "string")) return FAILED;
    define(result, "id", id.value);
    const name = Object.getOwnPropertyDescriptor(value, "name");
    if (!(name?.enumerable && "value" in name && typeof name.value === "string")) return FAILED;
    define(result, "name", name.value);
    const count = Object.getOwnPropertyDescriptor(value, "count");
    if (!(count?.enumerable && "value" in count && typeof count.value === "number")) return FAILED;
    define(result, "count", count.value);
    const active = Object.getOwnPropertyDescriptor(value, "active");
    if (!(active?.enumerable && "value" in active && typeof active.value === "boolean")) return FAILED;
    define(result, "active", active.value);
    return result;
  };

  const Order = types.Order;
  const Small = types.Small;
  assert.ok(Order && Small, "the benchmark module must export both Types");
  // The ceiling only means anything if it produces what parse produces.
  assert.deepEqual(fusedOrder(JSON.parse(bodies.order)), Order.parse(JSON.parse(bodies.order)));
  assert.deepEqual(fusedSmall(JSON.parse(bodies.small)), Small.parse(JSON.parse(bodies.small)));
  // Same rule for the entry that shipped: it only means anything if it answers
  // what parsing the owned-data rebuild answers.
  assert.deepEqual(parseTyped(Order, bodies.order), Order.parse(parseJson(bodies.order)));
  assert.deepEqual(parseTyped(Small, bodies.small), Small.parse(parseJson(bodies.small)));

  const measure = (label: string, body: () => unknown, iterations: number): number => {
    for (let index = 0; index < Math.min(iterations, 20_000); index += 1) body();
    const samples: number[] = [];
    for (let round = 0; round < 7; round += 1) {
      const started = process.hrtime.bigint();
      for (let index = 0; index < iterations; index += 1) body();
      samples.push(Number(process.hrtime.bigint() - started) / iterations / 1000);
    }
    samples.sort((first, second) => first - second);
    const median = samples[3]!;
    console.log(`  ${label.padEnd(46)} ${median.toFixed(3).padStart(9)} us`);
    return median;
  };

  for (const [name, body, iterations] of [["small flat record", bodies.small, 200_000], ["nested record, 20 items", bodies.order, 20_000]] as const) {
    const Type = name.startsWith("small") ? Small : Order;
    const fused = name.startsWith("small") ? fusedSmall : fusedOrder;
    console.log(`\n${name} — ${body.length} byte body`);
    const host = measure("host JSON.parse", () => JSON.parse(body), iterations);
    const decoded = measure("Json.parse (host parse + owned-data rebuild)", () => parseJson(body), iterations);
    const checked = measure("host JSON.parse + Type.is", () => Type.is(JSON.parse(body)), iterations);
    const parsed = measure("host JSON.parse + Type.parse (shipped)", () => Type.parse(JSON.parse(body)), iterations);
    const fastest = measure("host JSON.parse + fused validate-and-build", () => fused(JSON.parse(body)), iterations);
    const before = measure("Json.parse + Type.parse (typed read, before)", () => Type.parse(parseJson(body)), iterations);
    const after = measure("typed decode + Type.parse (typed read, now)", () => parseTyped(Type, body), iterations);
    console.log(`  ${"".padEnd(46)}`);
    console.log(`  owned-data rebuild inside Json.parse           ${(decoded - host).toFixed(3).padStart(9)} us`);
    console.log(`  Type.parse validate walk                      ${(checked - host).toFixed(3).padStart(9)} us`);
    console.log(`  Type.parse copy walk                          ${(parsed - checked).toFixed(3).padStart(9)} us`);
    console.log(`  fusing the two would save                     ${(parsed - fastest).toFixed(3).padStart(9)} us`);
    console.log(`  skipping the discarded rebuild saves          ${(before - after).toFixed(3).padStart(9)} us  (${((before - after) / before * 100).toFixed(1)}% of the typed read)`);
  }
} finally {
  await rm(directory, {recursive: true, force: true});
}
