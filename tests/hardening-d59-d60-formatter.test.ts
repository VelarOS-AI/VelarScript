import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile, formatSource } from "@velarscript/compiler";
import { keywordKinds } from "../packages/compiler/src/token.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// ---------------------------------------------------------------------------
// D60 rule 147 and D59 rules 142/143 — the formatter's spacing judgments.
//
// All of them were one defect: a judgment that is about *position* — what can
// stand in front of `[`, `(`, `-`, `<` — had been written as a hand-kept list
// of the words and punctuation that happened to be known when each rule was
// added. The list was blind to `const`, to `async`, to `return` in front of an
// operator, and to `??` in front of an element, and `--check` then enforced
// whatever it wrote. That is the D57 rule 134 family, so these tests pin the
// derivation and the invariant rather than the individual shapes.
//
// The ledger's evidence for rule 147 was `velar check` on a formatted file —
// execution level — so the invariant test compiles the formatter's output.
// ---------------------------------------------------------------------------

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tourRoot = join(repositoryRoot, "examples", "tour");

function core(source: string): string {
  return formatSource(source);
}

function web(source: string): string {
  return formatSource(source, { extensions: [velarCompilerExtension] });
}

function coreDiagnostics(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function webDiagnostics(source: string, path = "app.vel"): readonly string[] {
  return compile(source, { path, extensions: [velarCompilerExtension] }).diagnostics
    .map((item) => `${item.code} ${item.message}`);
}

// ---------------------------------------------------------------------------
// Rule 147 — the invariant itself: source that compiles still compiles after
// `velar format`. A formatter may write code the author finds ugly; writing
// code the compiler rejects is a different order of failure, because an author
// whose file breaks under `velar format` never runs it again.
// ---------------------------------------------------------------------------

const COMPILING_WEB_SOURCES: readonly (readonly [string, string])[] = [
  ["an element as the right operand of ??", `
component Note(text: string?):
    return <p>{text ?? <em>inline</em>}</p>
`],
  ["a self-closing component as the right operand of ??", `
component Fallback():
    return <i>none</i>

component Note(text: string?):
    return <p>{text ?? <Fallback />}</p>
`],
  ["a void element as the right operand of ??", `
component Note(text: string?):
    return <p>{text ?? <br />}</p>
`],
  ["elements on both arms of a conditional", `
component Note(flag: bool):
    return <p>{flag ? <span>yes</span> : <span>no</span>}</p>
`],
  ["an element after a comma, inside a call", `
def wrap(index: number, child: WebNode) -> WebNode:
    return <div>{index}{child}</div>

component Note():
    return <p>{wrap(1, <i>x</i>)}</p>
`],
  ["an element as a named argument's value", `
def wrap(child: WebNode) -> WebNode:
    return <div>{child}</div>

component Note():
    return <p>{wrap(child=<i>x</i>)}</p>
`],
];

test("[D60-147] source that compiles still compiles after the formatter rewrites it", () => {
  for (const [label, source] of COMPILING_WEB_SOURCES) {
    assert.deepEqual(webDiagnostics(source), [], `${label}: the corpus entry must compile before formatting`);
    const formatted = web(source);
    assert.deepEqual(webDiagnostics(formatted), [], `${label}: it must still compile after formatting\n${formatted}`);
    assert.equal(web(formatted), formatted, `${label}: formatting must be idempotent`);
  }
});

test("[D60-147] formatting never changes what the compiler says about a file", () => {
  // The element after `and` is a semantic error, not a syntax one — the web
  // analyzer answers it with VEL5029. That answer is exactly what proves the
  // formatter still read an element there, and it must not change when the
  // file is formatted.
  const source = "component Note(flag: bool):\n    return <p>{flag and <em>on</em>}</p>\n";
  assert.equal(web(source), source);
  assert.deepEqual(webDiagnostics(source).map((message) => message.slice(0, 7)), ["VEL5029"]);
  assert.deepEqual(webDiagnostics(web(source)), webDiagnostics(source));
});

test("[D60-147] the element after ?? stays an element instead of becoming four comparisons", () => {
  const source = "component Note(text: string?):\n    return <p>{text ?? <em>inline</em>}</p>\n";
  assert.equal(web(source), source);
  // The shape the defect wrote. Pinning the exact wreckage keeps the test
  // honest about what regressed: `VEL2006 Unexpected tokens in interpolated
  // expression` is what the author saw next.
  const wrecked = "component Note(text: string?):\n    return <p>{text ?? < em > inline < / em >}</p>\n";
  assert.notEqual(web(source), wrecked);
  assert.equal(webDiagnostics(wrecked).some((message) => message.startsWith("VEL2006")), true);
});

test("[D60-147] an element keeps the space of the ',' or ':' in front of it", () => {
  assert.equal(
    web("component Note(flag: bool):\n    return <p>{flag ? <span>yes</span> : <span>no</span>}</p>\n"),
    "component Note(flag: bool):\n    return <p>{flag ? <span>yes</span> : <span>no</span>}</p>\n",
  );
  assert.equal(
    web("component Note():\n    return wrap(1, <i>x</i>)\n"),
    "component Note():\n    return wrap(1, <i>x</i>)\n",
  );
});

// ---------------------------------------------------------------------------
// Rule 147 — the same invariant over the corpus the tour already is. Every
// chapter compiles today; the formatter's output for every chapter has to
// compile too, whether or not the repository copy happens to be canonical.
// ---------------------------------------------------------------------------

async function velarSources(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".velar") continue;
      files.push(...await velarSources(path));
    } else if (entry.isFile() && entry.name.endsWith(".vel")) {
      files.push(path);
    }
  }
  return files.sort();
}

// The corpus is the point, so its size is pinned: a tour that quietly shrank
// would make this test pass by having nothing left to prove.
const TOUR_MODULE_COUNTS: readonly (readonly [string, number])[] = [["core", 21], ["web", 15], ["desktop", 5]];

for (const [chapterSet, moduleCount] of TOUR_MODULE_COUNTS) {
  test(`[D60-147] the ${chapterSet} tour still compiles after the formatter rewrites every chapter`, async () => {
    const projectDirectory = join(tourRoot, chapterSet);
    const config = await resolveVelarProject(projectDirectory);
    const sources = await velarSources(projectDirectory);
    assert.equal(sources.length >= moduleCount, true, `the ${chapterSet} tour is ${sources.length} modules, was ${moduleCount}`);

    const formatted = new Map<string, string>();
    for (const path of sources) {
      const original = await readFile(path, "utf8");
      const result = formatSource(original, { extensions: config.compilerExtensions });
      assert.equal(
        formatSource(result, { extensions: config.compilerExtensions }),
        result,
        `${relative(repositoryRoot, path)}: formatting must be idempotent`,
      );
      formatted.set(path, result);
    }

    const options = {
      sourceRoot: config.root,
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions: config.compilerExtensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
    };
    const entries = [config.entryPath, ...sources.filter((path) => path.endsWith(".test.vel"))];
    for (const entry of entries) {
      const project = await compileProject(entry, formatted, {
        ...options,
        exportTestFunctions: entry.endsWith(".test.vel"),
      });
      const failures = [
        ...project.failures.map((failure) => `${relative(repositoryRoot, failure.path)}: ${failure.message}`),
        ...project.modules.flatMap((module) => module.result.diagnostics
          .map((item) => `${relative(repositoryRoot, module.inputPath)}: ${item.code} ${item.message}`)),
      ];
      assert.deepEqual(failures, [], `formatted ${relative(repositoryRoot, entry)} must compile`);
    }
  });
}

// ---------------------------------------------------------------------------
// Rule 142 — a named argument is `name=value`, the charter's spelling and the
// one every documentation table uses. The formatter wrote the other one, and
// `--check` made the repository follow it.
// ---------------------------------------------------------------------------

test("[D59-142] a named argument is written tight, whatever its value is", () => {
  assert.equal(core(`const x = label("a", prefix="<")\n`), `const x = label("a", prefix="<")\n`);
  assert.equal(core(`const x = label("a", prefix = "<")\n`), `const x = label("a", prefix="<")\n`);
  assert.equal(core("const y = shadow(0px, spread = 0px, inset = false)\n"), "const y = shadow(0px, spread=0px, inset=false)\n");
  assert.equal(core("const z = values.reduce(combine = (a, b) => a + b, initial = 0)\n"), "const z = values.reduce(combine=(a, b) => a + b, initial=0)\n");
  assert.equal(core(`const w = properties.set(key = "n", value = {type: "bool"})\n`), `const w = properties.set(key="n", value={type: "bool"})\n`);
  assert.equal(core(`const v = resolve(parts = ["/srv", "app"])\n`), `const v = resolve(parts=["/srv", "app"])\n`);
  assert.equal(core("const u = at(index = -1)\n"), "const u = at(index=-1)\n");
  assert.equal(core(`const t = expect(1).toBe(expected = 1)\n`), `const t = expect(1).toBe(expected=1)\n`);
});

test("[D59-142] an element passed as a named argument is written tight too", () => {
  assert.equal(
    web("component Note():\n    return wrap(child = <i>x</i>)\n"),
    "component Note():\n    return wrap(child=<i>x</i>)\n",
  );
});

test("[D59-142] a default value is not a named argument and keeps its spaces", () => {
  // A lambda's parentheses hold parameters, never arguments.
  assert.equal(core("const g = (x = 1) => x\n"), "const g = (x = 1) => x\n");
  assert.equal(core("const g = run((x = 1) => x)\n"), "const g = run((x = 1) => x)\n");
  // A declaration's parentheses hold parameters as well — by `def` in front of
  // the name, or by standing at the head of a line that opens a block.
  assert.equal(core("def f(x = 1) -> unknown:\n    return x\n"), "def f(x = 1) -> unknown:\n    return x\n");
  assert.equal(core("def f(x: number = 1) -> number:\n    return x\n"), "def f(x: number = 1) -> number:\n    return x\n");
  assert.equal(
    core("class P:\n    constructor(x = 1):\n        pass\n"),
    "class P:\n    constructor(x = 1):\n        pass\n",
  );
  // A call inside a declaration's default value is still a call.
  assert.equal(
    core(`def f(x: string = label("a", prefix = "<")) -> string:\n    return x\n`),
    `def f(x: string = label("a", prefix="<")) -> string:\n    return x\n`,
  );
  // An assignment is a statement; only an argument is an argument.
  assert.equal(core("animation = animate(spin, 2s, loop = true)\n"), "animation = animate(spin, 2s, loop=true)\n");
  // A call in a condition is a call even though the line ends with a colon.
  assert.equal(core(`if check(name = "a"):\n    pass\n`), `if check(name="a"):\n    pass\n`);
});

// ---------------------------------------------------------------------------
// Rule 143 — the four unary/bracket misjudgments, and the derivation that
// replaced the whitelist behind them.
// ---------------------------------------------------------------------------

test("[D59-143.1] a bracket after a keyword opens a literal; after a name it indexes", () => {
  assert.equal(core("const[head, ...tail] = values\n"), "const [head, ...tail] = values\n");
  assert.equal(core("let[first, second] = values\n"), "let [first, second] = values\n");
  assert.equal(core("const item = values[0]\n"), "const item = values[0]\n");
  assert.equal(core("for i in [1, 2]:\n    pass\n"), "for i in [1, 2]:\n    pass\n");
  assert.equal(core("const item = values.at[0]\n"), "const item = values.at[0]\n");
});

test("[D59-143.2] parentheses after a keyword are not a call", () => {
  assert.equal(core("const f = async(id: string) => load(id)\n"), "const f = async (id: string) => load(id)\n");
  assert.equal(core("const f = async (id: string) => load(id)\n"), "const f = async (id: string) => load(id)\n");
  // `super` and `import` are the reserved words that do stand in expression
  // position, so the parentheses after them belong to them.
  assert.equal(
    core("class P extends E:\n    constructor(id: string):\n        super(id)\n"),
    "class P extends E:\n    constructor(id: string):\n        super(id)\n",
  );
  assert.equal(core(`const p = lazy(() => import("./page.vel"), "Page")\n`), `const p = lazy(() => import("./page.vel"), "Page")\n`);
});

test("[D59-143.3] a sign after a keyword is a sign, not a subtraction", () => {
  assert.equal(core("def f() -> number:\n    return -1\n"), "def f() -> number:\n    return -1\n");
  assert.equal(core("def f() -> number:\n    return - 1\n"), "def f() -> number:\n    return -1\n");
  assert.equal(core("def f(n: number) -> number:\n    return -n\n"), "def f(n: number) -> number:\n    return -n\n");
  assert.equal(
    core(`def f(n: number) -> string:\n    match n:\n        case - 1:\n            return "neg"\n        case _:\n            return "other"\n`),
    `def f(n: number) -> string:\n    match n:\n        case -1:\n            return "neg"\n        case _:\n            return "other"\n`,
  );
  // The subtraction it must not eat.
  assert.equal(core("const d = total - 1\n"), "const d = total - 1\n");
  assert.equal(core("const d = values[0] - 1\n"), "const d = values[0] - 1\n");
  assert.equal(core("const d = f() - 1\n"), "const d = f() - 1\n");
  assert.equal(core("const d = 2 - 1\n"), "const d = 2 - 1\n");
});

test("[D59-143.4] a continuation line reads the token in front of it from the previous line", () => {
  // Charter section 2: inside brackets a newline is not a statement boundary,
  // so `+ shipping` continues `basePrice` and is an addition.
  const continued = "const total = (\n    basePrice\n    + shipping\n    - discount\n)\n";
  assert.equal(core(continued), continued);
  assert.equal(core("const total = (\n    basePrice\n    +shipping\n    -discount\n)\n"), continued);
  assert.deepEqual(coreDiagnostics(
    "const basePrice = 1\nconst shipping = 2\nconst discount = 3\n" + continued,
  ), []);
  // The same question with the opposite answer: after the `[` that opened the
  // literal, a leading `-` is a sign.
  const literal = "const values = [\n    -1,\n    -2,\n]\n";
  assert.equal(core(literal), literal);
  assert.equal(core("const values = [\n    - 1,\n    - 2,\n]\n"), literal);
  // A comment is not part of the expression, so it does not become the context.
  assert.equal(
    core("const total = (\n    basePrice\n    // shipping is billed separately\n    + shipping\n)\n"),
    "const total = (\n    basePrice\n    // shipping is billed separately\n    + shipping\n)\n",
  );
});

test("[D57-134 family] the keyword judgment is derived from the language's vocabulary, not from a list in the formatter", () => {
  // The whitelist this replaced had `in` but never `const`, so `const [a] = x`
  // lost its space and stayed check-clean. Reading the lexer's own table means
  // a word the language gains tomorrow is covered on the day it is added.
  const standsInExpressionPosition = new Set(["true", "false", "null", "super", "import"]);
  for (const word of Object.keys(keywordKinds)) {
    const formatted = core(`${word} [1]\n`);
    assert.equal(
      formatted,
      standsInExpressionPosition.has(word) ? `${word}[1]\n` : `${word} [1]\n`,
      `'${word}' is a reserved word, so the bracket after it is judged by position`,
    );
  }
  // A member name spelled like a keyword is a name.
  assert.equal(core("const x = values.in(other)\n"), "const x = values.in(other)\n");
});

// ---------------------------------------------------------------------------
// D55 rule 127.2 family — a type argument list that holds a function type with
// parameters. The `:` naming a parameter had made the list fail to prove
// itself, and the brackets were re-spaced as comparisons.
// ---------------------------------------------------------------------------

test("[D55-127.2] a type argument list holds a parameterized function type", () => {
  assert.equal(core("type A = List<(x: number) -> string>\n"), "type A = List<(x: number) -> string>\n");
  assert.equal(core("type A = List < (x: number) -> string >\n"), "type A = List<(x: number) -> string>\n");
  assert.equal(core("type F = Handler<() -> string>\n"), "type F = Handler<() -> string>\n");
  assert.equal(core("type C = List<string>\n"), "type C = List<string>\n");
  assert.equal(
    core("const handler: List<(x: number) -> string> = build()\n"),
    "const handler: List<(x: number) -> string> = build()\n",
  );
  assert.equal(
    web("type TaskView = Component < (task: Task, compact?: bool) -> WebNode >\n"),
    "type TaskView = Component<(task: Task, compact?: bool) -> WebNode>\n",
  );
  assert.equal(
    web("type PanelView = Component < (title: string) -> WebNode, PanelHandle >\n"),
    "type PanelView = Component<(title: string) -> WebNode, PanelHandle>\n",
  );
});

test("[D55-127.2] a comparison in the same position is still a comparison", () => {
  // The `:` a record introduces is not a parameter's, and these are the two
  // shapes the proof exists for.
  assert.equal(core("const flags = {visible: count < limit, other: x > y}\n"), "const flags = {visible: count < limit, other: x > y}\n");
  assert.equal(core("const ok = a < b and c > d\n"), "const ok = a < b and c > d\n");
  assert.equal(core("const ok = {visible: count < limit}\n"), "const ok = {visible: count < limit}\n");
  assert.deepEqual(coreDiagnostics(
    "const count = 1\nconst limit = 2\nconst flags = {visible: count < limit}\n",
  ), []);
});
