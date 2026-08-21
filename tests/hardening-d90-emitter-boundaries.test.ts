import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compile } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// The four boundaries this file pins are the places where generated JavaScript
// stops being a transcription of the source and starts being a promise the
// language makes: a narrowing recheck proves what it says it proves, every
// `await` crosses the owned Promise boundary, author text cannot be mistaken
// for emitter metadata, and a checked JavaScript import observes the same value
// every other spelling of the same import observes.

after(removeTemporaryDirectories);

interface Execution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Compiles a module and refuses to continue past a diagnostic. */
function compiled(source: string): { readonly code: string; readonly result: ReturnType<typeof compile> } {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code !== null);
  return { code: result.code, result };
}

/**
 * Runs a compiled module beside its embedded sibling modules. The sibling
 * specifiers are relative, so writing every file into one directory is all the
 * host needs to resolve them.
 */
async function execute(result: ReturnType<typeof compile>, prefix: string): Promise<Execution> {
  const directory = await makeTemporaryDirectory(`velar-d90-emitter-${prefix}-`);
  for (const embedded of result.embeddedModules) {
    await writeFile(join(directory, embedded.specifier.replace(/^\.\//u, "")), embedded.code, "utf8");
  }
  const entry = join(directory, "main.mjs");
  await writeFile(entry, result.code ?? "", "utf8");
  const execution = spawnSync(process.execPath, [entry], { encoding: "utf8", timeout: 20_000 });
  return { status: execution.status, stdout: execution.stdout, stderr: execution.stderr };
}

async function run(source: string, prefix: string): Promise<Execution & { readonly code: string }> {
  const { code, result } = compiled(source);
  return { ...await execute(result, prefix), code };
}

/**
 * The filed program: a module-level binding narrowed by `!= null`, a call that
 * reassigns it to a foreign object behind the analyzer's back, and a field read
 * on the far side of the recheck.
 */
function narrowingProgram(wire: string, declared: boolean): string {
  return [
    "unsafe js`",
    `export const wire = ${wire};`,
    "`",
    "",
    ...declared ? ["type Cell:", "    a: number", ""] : [],
    declared ? "def build(flag: bool) -> Cell?:" : "def build(flag: bool):",
    "    if flag:",
    declared ? "        const cell: Cell = { a: 1 }" : "        const cell = { a: 1 }",
    "        return cell",
    "    return null",
    "",
    "let current = build(true)",
    "",
    "def poison():",
    "    current = wire",
    "",
    "def main():",
    "    if current != null:",
    "        poison()",
    "        print(current.a + 1)",
    "main()",
    "",
  ].join("\n");
}

test("[D90] a narrowing recheck against a structural object type proves its fields", async () => {
  // compiler-back-12: the recheck used to be `value !== null && typeof value
  // === "object"`, so the foreign `{ b: 2 }` passed the guard and the field
  // read printed NaN with no diagnostic and no error.
  const structural = await run(narrowingProgram("{ b: 2 }", false), "narrow-structural");
  assert.match(
    structural.code,
    /__velarNarrow\(__velarValue, \(__velarValue !== null && typeof __velarValue === "object" && typeof __velarValue\.a === "number"\), "\{ a: number \}", "current", \d+\)/u,
  );
  assert.equal(structural.status, 1, structural.stdout);
  assert.equal(structural.stdout, "");
  assert.match(structural.stderr, /NarrowingError: Flow narrowing for 'current' no longer holds: expected \{ a: number \}/u);

  // The control is the asymmetry the finding was about: naming the record type
  // must not change the strength of the guard. It routes through the generated
  // deep validator instead of an inline conjunction, and reports the same way.
  const named = await run(narrowingProgram("{ b: 2 }", true), "narrow-named");
  assert.match(named.code, /__velarNarrow\(__velarValue, __velarTypeCheck_Cell\(__velarValue\), "Cell", "current", \d+\)/u);
  assert.equal(named.status, 1, named.stdout);
  assert.match(named.stderr, /NarrowingError: Flow narrowing for 'current' no longer holds: expected Cell/u);

  // A field-by-field predicate proves the fields, not the whole object: a value
  // that carries the field keeps passing, extra keys and all, because a
  // structural object type is open exactly as it was before.
  const accepted = await run(narrowingProgram("{ a: 5, extra: true }", false), "narrow-accepted");
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout, "6\n");
});

test("[D90] a structural field's own evidence carries its runtime helpers into the module", async () => {
  // The inline field proof emits whatever each field's check needs — a
  // collection's `TypeIs` helper, a declared record's validator — into a module
  // that may name no runtime type of its own. The dependency walk over a
  // narrowing type has to follow the field table for the same reason the check
  // does, or the guard on a program that narrows correctly dies with a host
  // `ReferenceError: __velarListTypeIs is not defined` before it can answer.
  const collections = await run(`
unsafe js\`
export const wire = { items: ["ok"], tags: new Set(["t"]) };
export const wrong = { items: [1], tags: new Set(["t"]) };
\`

def build(flag: bool):
    if flag:
        return { items: ["a"], tags: Set(["b"]) }
    return null

let current = build(true)

def accept():
    current = wire

def poison():
    current = wrong

def main():
    if current != null:
        accept()
        print(f"accepted {current.items.size}")
    if current != null:
        poison()
        print(f"poisoned {current.items.size}")
main()
`, "narrow-structural-helpers");
  assert.match(collections.code, /__velarListTypeIs\(__velarValue\.items, \(item\) => typeof item === "string"\)/u);
  assert.match(collections.code, /__velarSetTypeIs\(__velarValue\.tags, \(item\) => typeof item === "string"\)/u);
  // The helpers the guard names are defined in the module that names them.
  assert.match(collections.code, /function __velarListTypeIs\(/u);
  assert.match(collections.code, /function __velarSetTypeIs\(/u);
  assert.equal(collections.status, 1, collections.stdout);
  assert.equal(collections.stdout, "accepted 1\n");
  assert.match(collections.stderr, /NarrowingError: Flow narrowing for 'current' no longer holds/u);
  assert.doesNotMatch(collections.stderr, /ReferenceError/u);
});

test("[D90] the structural recheck stops at its depth bound instead of expanding without one", async () => {
  // The inline field proof is an expression, so it cannot recurse the way a
  // generated validator does: it grows. The bound is what keeps a deeply
  // nested (or self-referential) structural type from expanding without limit,
  // and a position past the bound degrades to the presence test — the same
  // evidence charter section 5 allows an erased position — rather than
  // refusing a value the expression never got to inspect.
  const { code } = compiled(`
def build(flag: bool):
    if flag:
        return { a: { b: { c: { d: { e: 1 } } } } }
    return null

let current = build(true)

def poison():
    current = null

def main():
    if current != null:
        poison()
        print(f"{current.a.b.c.d.e}")
main()
`);
  const guard = code.split("\n").filter((line) => line.includes("__velarNarrow(__velarValue"));
  assert.equal(guard.length, 1, code);
  // Four levels are proved by their fields; the fifth carries presence only,
  // and the number at the bottom is not reached at all.
  assert.match(guard[0]!, /typeof __velarValue === "object"/u);
  assert.match(guard[0]!, /typeof __velarValue\.a\.b\.c === "object"/u);
  assert.match(guard[0]!, /typeof __velarValue\.a\.b\.c\.d === "object"/u);
  assert.doesNotMatch(guard[0]!, /__velarValue\.a\.b\.c\.d\.e/u);
});

test("[D90] every await crosses the owned Promise boundary, wherever it sits in the expression", async () => {
  // compiler-back-19: normalization used to be suppressed for the whole
  // subtree of the value being wrapped, so `await use(await thenable())`
  // emitted a bare inner `await` and adopted the foreign thenable — the same
  // call raised the owned error in statement position and returned 7 here.
  const foreign = await run(`
extern js()\`
    export function thenable() { return { then(resolve) { resolve(7) } } }
\`:
    export def thenable() -> Promise<number>

async def use(value: number) -> number:
    return value

async def main():
    try:
        const direct = await thenable()
        print(f"direct {direct}")
    catch error:
        print(f"direct caught {error.message}")
    try:
        const nested = await use(await thenable())
        print(f"nested {nested}")
    catch error:
        print(f"nested caught {error.message}")

await main()
`, "promise-thenable");
  assert.match(foreign.code, /const direct = await __velarNormalizePromiseValue\(thenable\(\)\);/u);
  assert.match(foreign.code, /const nested = await __velarNormalizePromiseValue\(use\(await __velarNormalizePromiseValue\(thenable\(\)\)\)\);/u);
  assert.equal(foreign.status, 0, foreign.stderr);
  assert.equal(foreign.stdout, "direct caught Expected an actual Promise\nnested caught Expected an actual Promise\n");

  // The resolved-`undefined` half of the same wrapper. The finder found it
  // largely re-covered downstream by the nullable read guards, so it is pinned
  // beside the boundary half rather than trusted to it: neither may regress
  // without the other being seen to.
  const resolved = await run(`
extern js()\`
    export function supply() { return Promise.resolve(undefined) }
\`:
    export def supply() -> Promise<number?>

async def hold(value: number?) -> number?:
    return value

async def main():
    const direct = await supply()
    print(f"direct isNull={direct == null}")
    const nested = await hold(await supply())
    print(f"nested isNull={nested == null}")

await main()
`, "promise-resolved");
  assert.match(resolved.code, /const nested = await __velarNormalizePromiseValue\(hold\(await __velarNormalizePromiseValue\(supply\(\)\)\)\);/u);
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout, "direct isNull=true\nnested isNull=true\n");
});

test("[D90] author text cannot spell one of the emitter's own source-map markers", async () => {
  // compiler-back-20: `\u{0}` is the sanctioned source spelling for a control
  // character and f-string text was the one literal form that did not escape
  // it, so the marker renderer deleted the author's bytes out of the emitted
  // string — the program below printed size 3 and rendered "AB1".
  const forged = await run(`
def main():
    const n = 1
    const s = f"A\\u{0}VELAR_MAP_0\\u{0}B{n}"
    print(s.size)
    print(s.replaceAll("\\u{0}", "|"))
main()
`, "marker-forgery");
  assert.match(forged.code, /const s = `A\\u0000VELAR_MAP_0\\u0000B\$\{n\}`;/u);
  // The rendered program has every marker stripped, so a surviving raw
  // U+0000 could only be author text — the byte the renderer scans for.
  // There is none: the control leaves as an escape sequence instead.
  assert.ok(!forged.code.includes("\u0000"), JSON.stringify(forged.code));
  assert.equal(forged.status, 0, forged.stderr);
  assert.equal(forged.stdout, "16\nA|VELAR_MAP_0|B1\n");

  // A marker id this emit never issued used to throw an uncaught host `Error`
  // out of `compile()` itself, with no diagnostic and nothing for a playground,
  // a language server, or CI to report. Compilation now answers with a result.
  const large = compile(`
def main():
    const n = 1
    const s = f"A\\u{0}VELAR_MAP_999999\\u{0}B{n}"
    print(s.size)
    print(s.replaceAll("\\u{0}", "|"))
main()
`.trimStart());
  assert.deepEqual(large.diagnostics, [], JSON.stringify(large.diagnostics));
  assert.ok(large.code !== null);
  const largeExecution = await execute(large, "marker-large-id");
  assert.equal(largeExecution.status, 0, largeExecution.stderr);
  assert.equal(largeExecution.stdout, "21\nA|VELAR_MAP_999999|B1\n");

  // The surrounding code keeps its mappings: dropping an unknown marker costs
  // at most the one mapping it would have carried, never the source map.
  assert.ok(large.sourceMap !== null);
  const map = JSON.parse(large.sourceMap) as { readonly version: number; readonly mappings: string };
  assert.equal(map.version, 3);
  assert.ok(map.mappings.length > 0, large.sourceMap);
});

test("[D90] every C0 control leaves an f-string as an escape, and a sibling module's own bytes are untouched", async () => {
  // The marker delimiter is U+0000, but the escape covers all of U+0000..
  // U+001F: a scan of generated text must never have to decide whether a raw
  // control byte is author text or emitter metadata, and `\u{1b}` is as
  // sanctioned a source spelling as `\u{0}`.
  const controls = Array.from({ length: 32 }, (_, index) => `\\u{${index.toString(16)}}`).join("");
  const swept = await run(`
def main():
    const n = 1
    const s = f"${controls}{n}"
    print(s.size)
main()
`, "marker-c0-sweep");
  // `\r` keeps the shorter spelling it already had; the other 31 leave as
  // `\u00xx`. What matters is that none of them leaves as a byte.
  assert.equal([...swept.code.matchAll(/\\u00[0-9a-f]{2}/gu)].length, 31, swept.code);
  const raw = [...swept.code].filter((character) => character.codePointAt(0)! < 32 && character !== "\n");
  assert.deepEqual(raw, [], JSON.stringify(swept.code));
  assert.equal(swept.status, 0, swept.stderr);
  assert.equal(swept.stdout, "33\n");

  // The escape belongs to VelarScript's own text, not to foreign source. A
  // sibling module is emitted from the author's JavaScript with its mappings
  // computed directly, never through the marker renderer, so escaping its
  // bytes would rewrite code Core does not own — and does not happen.
  const nul = String.fromCodePoint(0);
  const { result } = compiled([
    "unsafe js`",
    `export const t = "A${nul}VELAR_MAP_0${nul}B";`,
    "export function show(value) { console.log(value.length) }",
    "`",
    "",
    "def main():",
    "    show(t)",
    "main()",
    "",
  ].join("\n"));
  assert.equal(result.embeddedModules.length, 1);
  assert.ok(result.embeddedModules[0]!.code.includes(nul), JSON.stringify(result.embeddedModules[0]!.code));
  assert.ok(!(result.code ?? "").includes(nul), JSON.stringify(result.code));
  const sibling = await execute(result, "marker-sibling-bytes");
  assert.equal(sibling.status, 0, sibling.stderr);
  assert.equal(sibling.stdout, "15\n");
});

const liveJavaScript = "export let counter = 0; export function bump(){counter+=1}; export function read(){return counter}";
const liveModule = `data:text/javascript,${encodeURIComponent(liveJavaScript)}`;

test("[D90] a checked JavaScript import observes the live export every other spelling observes", async () => {
  // compiler-back-26: each checked path read the foreign binding once at module
  // initialization and froze it in a `const`, so one JavaScript declaration
  // reported three different values depending on which spelling read it —
  // `import js {counter}` said 0 while `import js * as` and `unsafe js` said 2.
  // Charter section 12 (line 2737): "an `export let` remains a live ES-module
  // value: the exporting module can reassign it between reads".
  const checkedBlock = `
extern js()\`
    ${liveJavaScript}
\`:
    export const counter: number
    export def bump() -> null
    export def read() -> number

def main():
    bump()
    bump()
    print(f"counter={counter} read={read()}")
main()
`;
  const named = `
extern module "${liveModule}":
    export const counter: number
    export def bump() -> null
    export def read() -> number

import js {counter, bump, read} from "${liveModule}"

def main():
    bump()
    bump()
    print(f"counter={counter} read={read()}")
main()
`;
  const namespace = `
extern module "${liveModule}":
    export const counter: number
    export def bump() -> null
    export def read() -> number

import js * as pkg from "${liveModule}"

def main():
    pkg.bump()
    pkg.bump()
    print(f"counter={pkg.counter} read={pkg.read()}")
main()
`;
  // `unsafe js` publishes no contract, so its names arrive without a declared
  // type; the annotations below are the reader's, not the boundary's.
  const unchecked = [
    "unsafe js`",
    `    ${liveJavaScript}`,
    "`",
    "",
    "def main():",
    "    bump()",
    "    bump()",
    "    const seen: number = counter",
    "    const total: number = read()",
    '    print(f"counter={seen} read={total}")',
    "main()",
    "",
  ].join("\n");

  const spellings: Record<string, string> = {
    "extern js() with a contract": checkedBlock,
    "extern module and import js {}": named,
    "extern module and import js * as": namespace,
    "unsafe js": unchecked,
  };
  for (const [spelling, source] of Object.entries(spellings)) {
    const execution = await run(source, "live-binding");
    assert.equal(execution.status, 0, `${spelling}: ${execution.stderr}`);
    assert.equal(execution.stdout, "counter=2 read=2\n", spelling);
  }

  // The shape that carries the guarantee: a real named import for the binding,
  // the presence probe beside it as its own statement, and no `const` anywhere
  // between the two — reading the namespace into a `const` is exactly what
  // froze the value.
  const { code } = compiled(named);
  assert.match(code, /^import \{ counter, bump, read \} from "data:text\/javascript,/mu);
  assert.match(code, /^import \* as (__velarExternModule\d+) from "data:text\/javascript,/mu);
  const moduleName = /^import \* as (__velarExternModule\d+) from /mu.exec(code)?.[1];
  assert.ok(moduleName);
  for (const name of ["counter", "bump", "read"]) {
    assert.ok(code.includes(`__velarExternExport(${moduleName}, ${JSON.stringify(name)}, `), name);
  }
  assert.doesNotMatch(code, /const \w+ = __velarExternExport\(/u);
  // The captureless checked block keeps its sibling module's own exports rather
  // than going through a snapshot factory.
  assert.doesNotMatch(compiled(checkedBlock).code, /__velarEmbeddedFactory/u);
});

test("[D90] a checked block with captures reaches them through the factory", async () => {
  // The factory exists for exactly one reason: to hand the block the values it
  // captured, as parameters. That is why the captureless block above keeps its
  // sibling module's own `export` declarations and this one does not, and the
  // shape below is what makes a capture reach the JavaScript at all.
  //
  // RESIDUE, deliberately not asserted here so no test blesses a value that is
  // wrong: this is the fifth spelling of the same import, and it is the one
  // that still disagrees with the four above. A capture arrives as a function
  // parameter, so the block's own bindings are function-local, and the only
  // way a JavaScript scope publishes a live binding is by being a module. So
  // `counter` read directly is the value it held when the factory returned,
  // while `read()` — a closure over the same variable — answers with the live
  // one. Closing it needs either the block's declarations hoisted to the
  // sibling module's own scope or a contract spelling that says a name is
  // live; neither is an emitter-local change.
  const captured = await run(`
const step = 3

extern js(step: number)\`
    export let counter = 0
    export function bump(){ counter += step }
    export function read(){ return counter }
\`:
    export const counter: number
    export def bump() -> null
    export def read() -> number

def main():
    bump()
    bump()
    print(f"read={read()}")
main()
`, "checked-captures");
  assert.match(captured.code, /^import \{ __velarEmbeddedFactory_0 as __velarEmbeddedFactoryBinding_0 \} from "\.\/[^"]+";$/mu);
  assert.match(captured.code, /^const \{ bump, read, counter \} = __velarEmbeddedFactoryBinding_0\(step\);$/mu);
  assert.equal(captured.status, 0, captured.stderr);
  assert.equal(captured.stdout, "read=6\n");
});

test("[D90] the checked import still refuses a declared export the JavaScript does not have", async () => {
  // W-22's guarantee survives the live binding: the probe runs beside the
  // import rather than instead of it. Under a host that links named imports
  // eagerly the refusal arrives from the link step; under bundled CommonJS
  // interop, where the name links to `undefined` instead, the probe statement
  // is what reports. Either way the program stops and names the export.
  const absent = `data:text/javascript,${encodeURIComponent("export let counter = 0;")}`;
  const { result } = compiled(`
extern module "${absent}":
    export const counter: number
    export def read() -> number

import js {counter, read} from "${absent}"

def main():
    print(f"{counter}")
main()
`);
  const execution = await execute(result, "missing-export");
  assert.equal(execution.status, 1, execution.stdout);
  assert.match(execution.stderr, /read/u);
});
