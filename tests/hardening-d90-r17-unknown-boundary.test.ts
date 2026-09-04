import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

// D90 R17 — the JavaScript boundary hands back `unknown`, never `any`.
//
// R12 refused `any` at export positions; this ruling closes the entry: an
// undeclared foreign value (`import js unsafe`, an `unsafe js` block export)
// arrives as `unknown` and must be validated into a concrete type
// (`Type.parse`, or `is` narrowing) before members, calls, indexing, or
// operators touch it. Every refusal teaches the ritual with the author's own
// expression spelled into the message.

function messages(source: string, options: Parameters<typeof compile>[1] = {}): string[] {
  return compile(source.trimStart(), options).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code, timeout: 10_000 });
}

const unsafeImport = 'import js unsafe {mystery} from "node:process"\n';

test("[D90 R17] an unsafe import arrives as unknown, and every use refuses toward validation", () => {
  // Member access spells the author's receiver and the parse ritual.
  assert.deepEqual(messages(`${unsafeImport}print(mystery.arch)\n`), [
    "VEL4001 Cannot access 'arch' on unknown without validation; declare a type naming the fields you rely on — 'type Mystery:' with the 'arch' field — then validate first: 'const checked = Mystery.parse(mystery)' and read 'checked.arch'",
  ]);

  // A call teaches the declaration, because a callable cannot be parsed into.
  assert.deepEqual(messages(`${unsafeImport}mystery()\n`), [
    "VEL4001 Cannot call an unknown JavaScript value without a declaration or validation; declare the signature — an 'extern module' contract or a contracted 'extern js' block gives 'mystery' a checked type — or validate the data it came from with 'Type.parse' first",
  ]);

  // Operators go through assignability and teach the narrowing spelling.
  assert.deepEqual(messages(`${unsafeImport}const n = mystery + 1\nprint(n)\n`), [
    "VEL4001 Cannot assign unknown to number; a boundary value stays unknown until validated at the edge — narrow it with 'value is number', or parse a declared shape",
  ]);

  // Indexing teaches the same parse ritual.
  const indexed = messages(`${unsafeImport}const x = mystery[0]\nprint(x)\n`);
  assert.equal(indexed.length, 1, indexed.join("\n"));
  assert.match(indexed[0]!, /Cannot index unknown; declare a type naming the shape you rely on — 'type Mystery:' — then validate first: 'const checked = Mystery\.parse\(mystery\)'/u);
});

test("[D90 R17] the four former any-exceptions fall out of the one unknown rule", () => {
  // Condition: one message for the unchecked boundary domain.
  assert.deepEqual(messages(`${unsafeImport}if mystery:\n    pass\n`), [
    "VEL4001 A condition judges only bool, and an unchecked unknown would ride JavaScript truthiness (0 and \"\" become false); validate the value at the edge — 'Type.parse' — and judge the checked result, or compare it explicitly",
  ]);

  // Await: the boundary thenable is refused toward a declared contract.
  const awaited = messages(`${unsafeImport}async def f():\n    await mystery\ndef g():\n    detach f()\ng()\n`);
  assert.ok(awaited.some((item) => /Cannot await unknown; an unchecked thenable runs foreign hooks and can leak raw undefined — declare the source in an extern contract/u.test(item)), awaited.join("\n"));

  // str() and the f-string share the text-conversion contract and describe
  // the boundary value as the unknown it is.
  const stringified = messages(`${unsafeImport}print(str(mystery))\n`);
  assert.ok(stringified.some((item) => /VEL4026 .*format unknown explicitly/u.test(item)), stringified.join("\n"));
  const interpolated = messages(`${unsafeImport}print(f"{mystery}")\n`);
  assert.ok(interpolated.some((item) => /VEL4026 .*format unknown explicitly/u.test(item)), interpolated.join("\n"));
});

test("[D90 R17] an unsafe js block's exports are unknown too, under one rule", () => {
  const block = 'unsafe js`\n    export const record = { arch: "arm64" }\n`\n';
  assert.deepEqual(messages(`${block}print(record.arch)\n`), [
    "VEL4001 Cannot access 'arch' on unknown without validation; declare a type naming the fields you rely on — 'type Record:' with the 'arch' field — then validate first: 'const checked = Record.parse(record)' and read 'checked.arch'",
  ]);

  // A null comparison needs no promise, so the reference itself stays legal.
  assert.deepEqual(messages(`${block}print(record == null)\n`), []);
});

test("[D90 R17] Type.parse and 'is' narrowing are the way in, and they execute", () => {
  const source = `
unsafe js\`
    export const report = { arch: "arm64", node: "24" };
\`

type EngineReport:
    arch: string
    node: string

const checked = EngineReport.parse(report)
print(f"{checked.arch} on Node {checked.node}")
`;
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  // The block lands as a sibling module; inline it as a data URL so the
  // program executes from a single stream.
  const sibling = result.embeddedModules[0]!;
  const inlined = (result.code ?? "").replace(
    JSON.stringify(sibling.specifier),
    JSON.stringify(`data:text/javascript;base64,${Buffer.from(sibling.code).toString("base64")}`),
  );
  const execution = executeModule(inlined);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "arm64 on Node 24\n");

  // A primitive narrows with `is` instead of a declared record.
  assert.deepEqual(messages(`${unsafeImport}def read() -> number:\n    if mystery is number:\n        return mystery\n    return 0\n`), []);
});

test("[D90 R17] an unsafe binding exports as unknown without tripping the R12 any boundary", () => {
  // Before the ruling this published `leaked: any` and R12 refused it; the
  // value is unknown now, which a consumer must validate — an honest export.
  assert.deepEqual(messages(`${unsafeImport}export const leaked = mystery\n`), []);
});

test("[D90 R17] a host-injected binding is a declaration and still wins over 'unsafe'", () => {
  // The compile host's `analysis.imports` channel answers for the name, so
  // the boundary no longer needs to guess — including a host that injects
  // `any` (the packages/web extension still does, until its own migration).
  const injected = messages(`${unsafeImport.replace("node:process", "fixture")}print(mystery.arch)\n`, {
    analysis: { imports: new Map([["mystery", { kind: "any" } as const]]) },
  });
  assert.deepEqual(injected, []);
});

test("[D90 R17] the Map and Set bare bindings are unknown, never a silent any", () => {
  // Neighbour of the boundary producers: `Map`/`Set` as bare values used to
  // be `any`, so `m.bogus` compiled silently with no `unsafe` in sight. The
  // constructor call forms keep their own special-cased inference.
  const bare = messages("const m = Map\nconst x = m.bogus\nprint(x)\n");
  assert.equal(bare.length, 1, bare.join("\n"));
  assert.match(bare[0]!, /Cannot access 'bogus' on unknown without validation/u);
  assert.deepEqual(messages('const m = Map([["a", 1]])\nprint(m.size)\n'), []);
  assert.deepEqual(messages("const s = Set([1, 2])\nprint(s.size)\n"), []);
});

test("[D90 R17] a merge cannot absorb the boundary value into a checked type", () => {
  // A bare `unknown` is the inference seed a merge absorbs ("nothing known
  // yet"); the boundary value is *known to be unchecked*, so `[mystery, 5]`
  // stays `List<unknown | number>` instead of laundering into `List<number>`.
  const laundered = messages(`${unsafeImport}const xs = [mystery, 5]\nconst n: number = xs[0]\nprint(n + 1)\n`);
  assert.ok(laundered.some((item) => /Cannot assign unknown \| number to number/u.test(item)), laundered.join("\n"));
});

test("[D90 R17] the written 'any' annotation stays refused, toward unknown and Type.parse", () => {
  assert.deepEqual(messages(`${unsafeImport}const held: any = mystery\nprint(held == null)\n`), [
    "VEL4001 'any' is not a VelarScript type; a foreign value arrives as 'unknown', which is what you annotate; declare a type naming the shape you rely on — 'type X:' — then validate first: 'const checked = X.parse(value)' and use 'checked' from there",
  ]);
});

test("[D90 R17] the refused 'any' names the unknown arrival and the parse entrance, at every annotation position", () => {
  // The refusal used to give its reason as "'any' is reserved for explicit
  // unsafe JavaScript boundaries". R17 removed the producer that clause named:
  // no boundary hands back `any` any more, so the reason was false and taught
  // nothing. The message now teaches the same entrance every other refusal on
  // an unknown teaches — and it must do so wherever the annotation is written,
  // not only on the `const` the original report happened to use.
  const positions = [
    "def escape(value: any) -> string:\n    return \"x\"\n",
    "def escape(value: string) -> any:\n    return value\n",
    "let value: any = 1\nprint(value)\n",
    "type Holder:\n    held: any\n",
    "class Box:\n    const held: any = 1\n",
  ];
  for (const source of positions) {
    const reported = messages(source).filter((item) => item.includes("'any'"));
    assert.equal(reported.length, 1, `${source}\n${reported.join("\n")}`);
    const message = reported[0]!;
    assert.match(message, /^VEL4001 'any' is not a VelarScript type;/u);
    assert.match(message, /arrives as 'unknown'/u);
    assert.match(message, /'const checked = X\.parse\(value\)'/u);
    // The retired reason clause names a producer this ruling deleted.
    assert.doesNotMatch(message, /reserved for explicit unsafe JavaScript boundaries/u);
  }
});
