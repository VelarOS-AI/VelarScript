import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  bindingNameRestriction,
  compile,
  CORE_PRELUDE_NAMES,
  CORE_VOCABULARY_NAMES,
  formatSource,
  PERMANENT_NAMESPACE_NAMES,
  permanentNamespaceCoveringModule,
} from "@velarscript/compiler";
import { completionItemsFor } from "../packages/cli/src/language-server.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleInterfaces, standardModuleSource } from "../packages/cli/src/standard-modules.ts";

// ---------------------------------------------------------------------------
// D57 rule 134 — the family: a list that should be derived was hand-kept, so it
// went blind to new members. These tests pin the derivation, not the members.
// ---------------------------------------------------------------------------

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

async function projectMessages(source: string): Promise<readonly string[]> {
  const entry = join(tmpdir(), `velar-d57-${Math.random().toString(36).slice(2)}`, "main.vel");
  const project = await compileProject(entry, new Map([[entry, source]]), {});
  return [
    ...project.modules.flatMap((module) => module.result.diagnostics).map((item) => `${item.code} ${item.message}`),
    ...project.failures.map((item) => item.message),
  ];
}

function executeModule(code: string) {
  // The namespaces lower to imports of the standard runtime modules, so link
  // them in the way every other execution-level test does.
  let linked = code;
  for (const source of ["velar/async", "velar/compiler-runtime-range-v1", "velar/json", "velar/math", "velar/text"]) {
    const runtime = standardModuleSource(source);
    if (!runtime) continue;
    linked = linked.replaceAll(
      JSON.stringify(source),
      JSON.stringify(`data:text/javascript;base64,${Buffer.from(runtime).toString("base64")}`),
    );
  }
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Rule 135 — the permanent namespaces and the prelude names cannot be shadowed
// ---------------------------------------------------------------------------

test("[D57-135] every Core vocabulary name is refused as a binding, from the roster rather than a copy", () => {
  // The roster is the authority the analyzer keys its builtin table by. Reading
  // the expectation off it is the point: a namespace or prelude name added
  // later is protected without this test being edited. Naming the nine members
  // as well proves the roster itself did not quietly shrink.
  assert.deepEqual([...PERMANENT_NAMESPACE_NAMES], ["Json", "Promise", "Text", "Math"]);
  assert.deepEqual([...CORE_PRELUDE_NAMES], ["number", "str", "print", "equals", "range"]);
  assert.deepEqual([...CORE_VOCABULARY_NAMES], [...PERMANENT_NAMESPACE_NAMES, ...CORE_PRELUDE_NAMES]);

  for (const name of CORE_VOCABULARY_NAMES) {
    assert.equal(bindingNameRestriction(name), "core", `${name} must be a reserved Core binding`);
    assert.deepEqual(messages(`const ${name} = 1\n`), [`VEL3007 '${name}' is a reserved Core binding`]);
    // The other half of the pin: the roster name has to resolve as a builtin,
    // so a name can never be protected here while resolving nowhere.
    assert.deepEqual(messages(`const value = ${name}\n`).filter((item) => item.startsWith("VEL3001")), []);
  }
});

test("[D57-135] the refusal reaches every binding position, not only module const", () => {
  const positions = (name: string): readonly string[] => [
    `let ${name} = 1\n`,
    `def ${name}():\n    return null\n`,
    `def take(${name}: number):\n    return null\n`,
    `for ${name} in [1, 2]:\n    print(1)\n`,
    `class Holder:\n    def method(${name}: number):\n        return null\n`,
    `def outer():\n    const ${name} = 1\n    return null\n`,
  ];
  for (const name of CORE_VOCABULARY_NAMES) {
    for (const source of positions(name)) {
      assert.ok(
        messages(source).includes(`VEL3007 '${name}' is a reserved Core binding`),
        `${name}: ${source} reported ${messages(source).join(" | ")}`,
      );
    }
  }
});

test("[D57-135] a record named Text no longer takes the namespace over", () => {
  // The module D57 quotes: it compiled clean, and every later `Text.` read in
  // the file silently resolved to the local record instead of the namespace.
  const result = compile(`
const Text = {slug: "not a function"}

export def broken() -> string:
    return Text.slug
`.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL3007 'Text' is a reserved Core binding",
  ]);
  assert.equal(result.code, null);

  // The namespace itself still works, so the refusal is protection and not loss.
  const kept = compile('print(Text.slug("Velar Script"))\n');
  assert.deepEqual(kept.diagnostics, []);
  assert.match(kept.code ?? "", /__velarTextNamespace\.slug\("Velar Script"\)/u);
});

test("[D57-135] Math is protected as a namespace, not as a JavaScript coincidence", () => {
  // `Math` used to be refused only because it happens to be a JavaScript global
  // too. Every namespace beside it went unprotected, so the coincidence is what
  // this test rules out: the four namespaces answer identically.
  for (const name of PERMANENT_NAMESPACE_NAMES) {
    assert.deepEqual(messages(`const ${name} = 1\n`), [`VEL3007 '${name}' is a reserved Core binding`]);
    assert.deepEqual(messages(`import {parse} from "./other.vel"\nconst value = parse\n`).filter((item) => item.includes(name)), []);
  }
  // A prelude name and a namespace name reach the same refusal from the same
  // roster, which is what makes 'derived' checkable rather than a claim.
  assert.equal(bindingNameRestriction("equals"), bindingNameRestriction("Math"));
  assert.equal(bindingNameRestriction("range"), bindingNameRestriction("print"));
});

test("[D57-135] the prelude and the namespaces still execute after the refusal lands", () => {
  const result = compile(`
print(str(equals([1, 2], [1, 2])))
print(range(3))
print(Math.max(2, 5))
print(Json.stringify({a: 1}))
print(Text.capitalize("velar"))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
});

// ---------------------------------------------------------------------------
// Rule 136 — the VEL6003 listing may not advertise a dead end
// ---------------------------------------------------------------------------

test("[D57-136] the unknown-module listing annotates exactly the modules whose imports VEL3008 refuses", async () => {
  const reported = await projectMessages('import {oops} from "velar/look"\n\nprint(1)\n');
  const listing = reported.find((item) => item.startsWith("VEL6003"));
  assert.ok(listing, reported.join("\n"));

  // Derived expectation: for every standard module, import every export it
  // publishes and read what the compiler says. A module whose exports all
  // answer VEL3008 with the same prefix has retired behind that prefix and must
  // be annotated with it; anything still importable must be listed bare.
  // Nothing here names a module — the migration state answers for itself.
  for (const [source, interface_] of standardModuleInterfaces()) {
    const exports_ = [...interface_.exports.keys()];
    if (exports_.length === 0) continue;
    const importMessages = await projectMessages(
      `import {${exports_.join(", ")}} from ${JSON.stringify(source)}\n\nprint(1)\n`,
    );
    const prefixes = new Set(importMessages
      .filter((item) => item.startsWith("VEL3008"))
      .map((item) => /Use (?<namespace>[A-Za-z]+)\./u.exec(item)?.groups?.namespace ?? ""));
    const retiredWholly = prefixes.size === 1 && !prefixes.has("")
      && importMessages.filter((item) => item.startsWith("VEL3008")).length === exports_.length;
    if (retiredWholly) {
      const prefix = [...prefixes][0];
      assert.ok(
        listing.includes(`${source} (its members read as ${prefix}.name and need no import)`),
        `${source} retired behind ${prefix}. but the listing says: ${listing}`,
      );
    } else {
      assert.ok(
        listing.includes(`${source}, `) || listing.endsWith(source),
        `${source} still publishes exports of its own but the listing annotates it: ${listing}`,
      );
    }
  }
});

test("[D57-136] the four migrated modules stay listed and say where their members went", async () => {
  const reported = await projectMessages('import {oops} from "velar/look"\n\nprint(1)\n');
  const listing = reported.find((item) => item.startsWith("VEL6003")) ?? "";
  for (const [source, namespace] of [
    ["velar/async", "Promise"],
    ["velar/json", "Json"],
    ["velar/math", "Math"],
    ["velar/text", "Text"],
  ] as const) {
    assert.ok(listing.includes(`${source} (its members read as ${namespace}.name and need no import)`), listing);
  }
  // D114 S3: velar/collections retired into checked List members, so it is not
  // listed at all — its own diagnostic says where its functions went.
  assert.ok(!listing.includes("velar/collections"), listing);
});

test("[D57-134] the editor's own vocabulary list is derived from the same two authorities", () => {
  const items = completionItemsFor(null);
  const labels = new Set(items.map((item) => item.label));
  // The hand-kept version had already lost `Math` and `number`: the namespace
  // arrived in a later wave and the list did not follow it. Reading the
  // expectation off the roster is what stops that recurring.
  for (const name of CORE_VOCABULARY_NAMES) {
    assert.ok(labels.has(name), `the editor offers no completion for ${name}`);
  }
  // And the module completions may not offer an import the compiler refuses.
  const interfaces = standardModuleInterfaces();
  for (const item of items.filter((entry) => entry.label.startsWith("velar/"))) {
    assert.equal(
      permanentNamespaceCoveringModule(item.label, interfaces.get(item.label)?.exports.keys() ?? []),
      null,
      `${item.label} retired behind a namespace but is still completed as an import`,
    );
  }
  assert.ok(!labels.has("velar/math"), "velar/math retired into Math. and must not be completed as an import");
  assert.ok(!labels.has("velar/async"), "velar/async retired into Promise. and must not be completed as an import");
  assert.ok(!labels.has("velar/collections"), "velar/collections retired into List members and must not be completed as an import");
  assert.ok(labels.has("velar/url"), "velar/url still publishes exports of its own");
});

// ---------------------------------------------------------------------------
// D55 rule 127.2 — the formatter reads type positions, not a list of names
// ---------------------------------------------------------------------------

test("[D55-127.2] a colon-introduced annotation formats generics for any type name", () => {
  for (const name of ["Record", "List", "Map", "Ledger", "MyOwnBox"]) {
    const parameter = `def take(x: ${name}<string>): return null\n`;
    const field = `type Node:\n    kids: ${name}<string>\n`;
    const binding = `const x: ${name}<string> = {}\n`;
    const alias = `type Alias = ${name}<string>\n`;
    const result = `def make() -> ${name}<string>: return {}\n`;
    for (const canonical of [parameter, field, binding, alias, result]) {
      assert.equal(formatSource(canonical), canonical, canonical);
      assert.equal(formatSource(formatSource(canonical)), canonical, canonical);
      const spaced = canonical.replace(`${name}<string>`, `${name} < string >`);
      assert.equal(formatSource(spaced), canonical, spaced);
    }
  }
});

test("[D55-127.2] type modifiers and nesting keep the annotation position", () => {
  for (const canonical of [
    "def inspect(pending: readonly Promise<List<number>>): return null\n",
    "const table: Map<string, Record<List<number>>> = {}\n",
    "const handler: List<() -> Record<string>> = []\n",
    "const optional: Record<string>? = null\n",
    "type Pair:\n    left: Record<string>\n    right: Record<number>\n",
    "class Box extends Holder<string>:\n    pass\n",
  ]) {
    assert.equal(formatSource(canonical), canonical, canonical);
    assert.equal(formatSource(formatSource(canonical)), canonical, canonical);
  }
  // An unspaced author writes the annotation and the initializer as one run;
  // the closing bracket is still the close even with '=' hard against it.
  assert.equal(
    formatSource("const values: List<number>=[1, 2, 3]\n"),
    "const values: List<number> = [1, 2, 3]\n",
  );
  assert.equal(
    formatSource("const table: Record<string>={}\n"),
    "const table: Record<string> = {}\n",
  );
});

test("[D55-127.2] a comparison that shares the colon position stays a comparison", () => {
  for (const canonical of [
    "const smaller = a < b\n",
    "const chained = a < b > c\n",
    "const flags = {visible: count < limit}\n",
    "const rows = {\n    visible: count < limit,\n}\n",
    "const mixed = {ok: a < b and c > d}\n",
    "render(width: left < right)\n",
    "const pair = {low: a < b, high: c > d}\n",
    "if count < limit: print(1)\n",
    "while index < items.size: index += 1\n",
  ]) {
    assert.equal(formatSource(canonical), canonical, canonical);
    assert.equal(formatSource(formatSource(canonical)), canonical, canonical);
  }
});

test("[D55-127.2] the corpus carries the spellings the format gate reads", async () => {
  // D55 rule 127.2: the gate passed only because no .vel file contained
  // `: Record<`. The module that states the Core language contract now does,
  // in all three positions the defect covered, so the gate sees them.
  //
  // The corpus moved out of `examples/` with D56 rule 131 (a corpus is not an
  // example), and a move is exactly how this coverage would go missing without
  // anyone noticing — the same shape as D61 rule 156. So the walk root is
  // asserted here beside the spellings: the file being right is worth nothing
  // if the gate no longer reaches it.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../tests/corpus/core.vel", import.meta.url), "utf8");
  assert.match(source, /^ {4}labels: Record<string>$/mu);
  assert.match(source, /^def labelFor\(labels: Record<string>, key: string\) -> string: return labels\[key\] \?\? "unlabelled"$/mu);
  assert.match(source, /^const labels: Record<string> = \{tier: "gold"\}$/mu);
  assert.equal(formatSource(source), source);

  const gate = await readFile(new URL("../scripts/check-velar-format.mjs", import.meta.url), "utf8");
  assert.match(gate, /velarSources\(join\(root, "tests"\)\)/u);
});
