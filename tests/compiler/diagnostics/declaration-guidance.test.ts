import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("guides mistyped declaration keywords to the current spelling", () => {
  const cases = new Map([
    ["fn addTask(tasks: List<number>, title: string) -> List<number>:\n    return tasks\n", /Use 'def'.*'def name\(\.\.\.\)'/u],
    ["func helper():\n    pass\n", /Use 'def'/u],
    ["function addTask(value: number) -> number:\n    return value\n", /Use 'def'/u],
    ["record Task(id: string, title: string, done: bool)\n", /Use 'type'.*'type Name:'/u],
    ["record Task:\n    id: string\n    title: string\n", /Use 'type'/u],
    ["struct Point:\n    x: number\n", /Use 'type'/u],
    ["interface Task:\n    id: string\n", /Use 'type'/u],
    ["schema Task:\n    id: string\n", /Use 'type'/u],
    ["class Player:\n    fn jump():\n        pass\n", /Use 'def'/u],
  ]);

  for (const [source, message] of cases) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.deepEqual(
      result.diagnostics.map((item) => item.code),
      ["VEL2026"],
      `${source}: ${JSON.stringify(result.diagnostics)}`,
    );
    assert.match(result.diagnostics[0]?.message ?? "", message, source);
  }
});

test("schema remains an ordinary data name outside declaration guidance", () => {
  const result = compileCore(`
type Contract:
    schema: string

def validate(schema: string) -> string:
    const record: Contract = {schema}
    return record.schema

print(validate("strict"))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "strict\n");
});

test("reports one unknown-declaration-keyword diagnostic instead of expression cascades", () => {
  const cases = new Map([
    ["defn helper(x: number) -> number:\n    return x\n", "defn"],
    ["myvar x: number = 5\n", "myvar"],
  ]);

  for (const [source, keyword] of cases) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2026"], source);
    assert.match(result.diagnostics[0]?.message ?? "", new RegExp(`Unknown declaration keyword '${keyword}'.*'def', 'type', 'enum', 'class', 'const', or 'let'`, "u"), source);
  }

  const legal = compile("def run(value: number) -> number:\n    return value\n\nconst result = run(2)\nprint(result)\n");
  assert.deepEqual(legal.diagnostics, []);
});

test("mistyped declaration keywords replace named-argument and reserved-binding cascades", () => {
  const result = compile(`
record Task(id: string, title: string, done: bool)

function addTask(tasks: List<number>, title: string) -> List<number>:
    return tasks
`.trimStart());

  assert.equal(result.code, null);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2026", "VEL2026"]);
  assert.match(result.diagnostics[0]?.message ?? "", /Use 'type'/u);
  assert.match(result.diagnostics[1]?.message ?? "", /Use 'def'/u);
  assert.ok(!result.diagnostics.some((item) => item.code === "VEL2024" || item.code === "VEL3007"));

  const consecutive = compile(`
function first(value: number) -> number:
    return value

function second(value: number) -> number:
    return value
`.trimStart());
  assert.deepEqual(consecutive.diagnostics.map((item) => item.code), ["VEL2026", "VEL2026"]);
});

test("guidance-token recovery co-reports lexer, parser, and analyzer guidance in one compile", () => {
  const result = compile("var values: Array<number> = []\nvalues.push(1)\n");
  assert.equal(result.code, null);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL1005", "VEL2012", "VEL4001"]);
  assert.match(result.diagnostics[0]?.message ?? "", /Use 'let' or 'const'/u);
  assert.match(result.diagnostics[1]?.message ?? "", /Use 'List<T>'/u);
  assert.match(result.diagnostics[2]?.message ?? "", /Use 'append\(value\)'/u);
});

test("recovered guidance programs still fail compilation and never emit", () => {
  const sources = [
    "const flag = True\n",
    "var count = 0\n",
    "const value = 1 if true else 2\n",
    "const accent = #f0f0f0\n",
    "const values: number[] = []\n",
    "fn helper():\n    pass\n",
    "record Task:\n    id: string\n",
  ];
  for (const source of sources) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.equal(result.sourceMap, null, source);
    assert.equal(result.css, null, source);
    assert.ok(result.diagnostics.length > 0, source);
    assert.ok(result.diagnostics.every((item) => item.recovered), source);
  }
});

test("mistyped declaration recovery surfaces body-level and semantic guidance together", () => {
  const fn = compile("fn addTask(tasks: List<number>) -> List<number>:\n    tasks.push(1)\n    return tasks\n");
  assert.equal(fn.code, null);
  assert.deepEqual(fn.diagnostics.map((item) => item.code), ["VEL2026", "VEL4001"]);
  assert.match(fn.diagnostics[0]?.message ?? "", /Use 'def'/u);
  assert.match(fn.diagnostics[1]?.message ?? "", /Use 'append\(value\)'/u);

  const record = compile("record Task:\n    id: string\n\nconst task = Task(id = \"t1\")\nprint(task.id)\n");
  assert.equal(record.code, null);
  assert.deepEqual(record.diagnostics.map((item) => item.code), ["VEL2026", "VEL4001"]);
  assert.match(record.diagnostics[0]?.message ?? "", /Use 'type'/u);
  assert.match(record.diagnostics[1]?.message ?? "", /record literal '\{field: value, \.\.\.\}'/u);

  const method = compile("class Player:\n    fn jump() -> number:\n        return 1\n\nconst player = Player()\nprint(player.jump())\n");
  assert.equal(method.code, null);
  assert.deepEqual(method.diagnostics.map((item) => item.code), ["VEL2026"]);
});

test("guidance without an unambiguous guided form keeps gating deeper stages", () => {
  const withResult = compile("const value = {a: 1}\nconst next = value with {a: 2}\nprint(missing)\n");
  assert.equal(withResult.code, null);
  assert.deepEqual(withResult.diagnostics.map((item) => item.code), ["VEL1005"]);
  assert.match(withResult.diagnostics[0]?.message ?? "", /does not expose 'with'/u);
});

test("guides bare hex colors to quoted strings without numeric-unit cascades", () => {
  const core = compile("const accent = #3478f6\nprint(accent)\n");
  assert.equal(core.code, null);
  assert.deepEqual(core.diagnostics.map((item) => item.code), ["VEL1005"]);
  assert.equal(
    core.diagnostics[0]?.message,
    "Use '\"#3478f6\"'; VelarScript writes hex colors as quoted strings or color builders such as rgb(...)",
  );

  // A Look block is an expression, so it is bound to a name; a bare 'look:'
  // statement discards its own value and reports that instead (VEL4030).
  const look = compile("const panel = look:\n    background = #f0f0f0\n");
  assert.equal(look.code, null);
  assert.deepEqual(look.diagnostics.map((item) => item.code), ["VEL1005"]);
  assert.match(look.diagnostics[0]?.message ?? "", /Use '"#f0f0f0"'/u);

  // A '#' that begins a line is Python-comment intuition, not a color: it is
  // guided to '//' and the commented text is skipped without a cascade.
  const comment = compile("# note\n");
  assert.deepEqual(comment.diagnostics.map((item) => item.code), ["VEL1005"]);
  assert.match(comment.diagnostics[0]?.message ?? "", /Use '\/\/' for comments/u);
  assert.ok(!comment.diagnostics.some((item) => item.code === "VEL1001"));
});

test("guides Python conditional expressions to the '?:' spelling", () => {
  const simple = compile("const value = 1 if true else 2\nprint(value)\n");
  assert.equal(simple.code, null);
  assert.deepEqual(simple.diagnostics.map((item) => item.code), ["VEL2027"]);
  assert.equal(
    simple.diagnostics[0]?.message,
    "Use 'cond ? x : y'; VelarScript writes conditional expressions with '?:', not 'x if cond else y'",
  );

  const nested = compile("const items = [1, 2]\nconst next = items.map(t => (t + 1 if t > 0 else t))\nprint(next)\n");
  assert.equal(nested.code, null);
  assert.deepEqual(nested.diagnostics.map((item) => item.code), ["VEL2027"]);

  const statement = compile("if true:\n    print(1)\nelse:\n    print(2)\n");
  assert.deepEqual(statement.diagnostics, []);

  const guarded = compile("match 1:\n    case 1 if true:\n        print(1)\n    case _:\n        print(2)\n");
  assert.deepEqual(guarded.diagnostics, []);
});

test("postfix array annotations guide directly to the List spelling", () => {
  const postfix = compile("const values: number[] = []\nprint(values)\n");
  assert.equal(postfix.code, null);
  assert.deepEqual(postfix.diagnostics.map((item) => item.code), ["VEL2012"]);
  assert.equal(
    postfix.diagnostics[0]?.message,
    "Use 'List<number>' for ordered collections; VelarScript has no postfix '[]' array types",
  );

  const named = compile("type Task:\n    id: string\n\nconst tasks: Task[] = []\nprint(tasks)\n");
  assert.deepEqual(named.diagnostics.map((item) => item.code), ["VEL2012"]);
  assert.match(named.diagnostics[0]?.message ?? "", /Use 'List<Task>'/u);

  const optional = compile("const values: number[]? = null\nprint(values)\n");
  assert.deepEqual(optional.diagnostics.map((item) => item.code), ["VEL2012"]);

  const bracketGenerics = compile("const values: List[number] = []\nprint(values)\n");
  assert.deepEqual(bracketGenerics.diagnostics.map((item) => item.code), ["VEL2012"]);
  assert.equal(bracketGenerics.diagnostics[0]?.message, "Generic type arguments use '<...>', not '[...]'");
});

test("guides JSX for blocks to '.map(...)' rendering", () => {
  const result = compile(`
component App:
    state messages: List<string> = []

    return <div>
        {for m in messages:
            <p>{m}</p>}
    </div>
`.trimStart());
  assert.equal(result.code, null);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL5049"]);
  assert.equal(
    result.diagnostics[0]?.message,
    "Use '{messages.map((m) => ...)}'; JSX has no 'for' blocks, so lists render with '.map(...)'",
  );
});

test("guides record literals against Map contracts, type-object calls, and legacy JS string methods", () => {
  const emptyMap = compile("let counts: Map<string, number> = {}\n");
  assert.equal(emptyMap.code, null);
  assert.ok(emptyMap.diagnostics.some((item) => item.code === "VEL4001"
    && /Use 'Map\(\)' to create an empty Map.*record literal '\{\}'/u.test(item.message)));

  const filledMap = compile("const counts: Map<string, number> = {a: 1}\n");
  assert.ok(filledMap.diagnostics.some((item) => item.code === "VEL4001"
    && /Use 'Map\(\{\.\.\.\}\)' to convert record fields/u.test(item.message)));

  const typeCall = compile("type Task:\n    id: string\n\nconst task = Task(id = \"t1\")\nprint(task.id)\n");
  assert.equal(typeCall.code, null);
  assert.ok(typeCall.diagnostics.some((item) => item.code === "VEL4001"
    && /Use a record literal '\{field: value, \.\.\.\}' to build a 'Task' value.*not a constructor/u.test(item.message)));

  const trim = compile("const value = \" x \".trim()\n");
  assert.deepEqual(trim.diagnostics, []);

  const upper = compile("const value = \"x\".toUpperCase()\n");
  assert.ok(upper.diagnostics.some((item) => item.code === "VEL4001"
    && /Use '\.upper\(\)'/u.test(item.message)));
});

test("guides component render-style blocks toward returning JSX directly", () => {
  for (const keyword of ["render", "show", "view"]) {
    const result = compile(`component App:\n    ${keyword}:\n        <div>hi</div>\n`);
    assert.equal(result.code, null, keyword);
    assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL5048"], keyword);
    assert.match(result.diagnostics[0]?.message ?? "", /Use 'return <\.\.\.>'/u, keyword);
    assert.match(result.diagnostics[0]?.message ?? "", new RegExp(`no '${keyword}:' block`, "u"), keyword);
  }
});

test("guides camelCase event attributes and bare bind to the Web directive spellings", () => {
  const result = compile(`
component App:
    state draft = ""

    def send():
        print(draft)

    return <div>
        <input bind={draft} onEnter={send} />
        <button onClick={send}>Send</button>
    </div>
`.trimStart());

  assert.equal(result.code, null);
  assert.ok(result.diagnostics.some((item) => item.code === "VEL5019"
    && /Use 'bind:value=\{name\}'.*bind:value or bind:checked/u.test(item.message)));
  assert.ok(result.diagnostics.some((item) => item.code === "VEL5025"
    && /Use 'on:click'.*on: directive/u.test(item.message)));
  assert.ok(result.diagnostics.some((item) => item.code === "VEL5025"
    && /Use 'on:keydown'.*event\.key == "Enter"/u.test(item.message)));
});

test("guides Look statement form, kebab-case properties, and multi-value shorthand", () => {
  const statement = compile("look bubble:\n    maxWidth = 240px\n");
  assert.equal(statement.code, null);
  assert.deepEqual(statement.diagnostics.map((item) => item.code), ["VEL5038"]);
  assert.match(statement.diagnostics[0]?.message ?? "", /Use 'const bubble = look:'.*look=\{bubble\}/u);

  const kebab = compile("export const bubble = look:\n    max-width = 240px\n    overflow-y = \"auto\"\n");
  assert.equal(kebab.code, null);
  assert.ok(kebab.diagnostics.some((item) => item.code === "VEL5038"
    && /Use 'maxWidth'.*DOM camelCase spelling/u.test(item.message)));
  assert.ok(kebab.diagnostics.some((item) => item.code === "VEL5038"
    && /Use 'overflowY'/u.test(item.message)));

  const shorthand = compile("export const bubble = look:\n    margin = 4px 0\n    padding = 8px 12px\n");
  assert.equal(shorthand.code, null);
  assert.ok(shorthand.diagnostics.some((item) => item.code === "VEL5038"
    && /Use 'spacing\(4px, 0px\)'.*spacing builder/u.test(item.message)));
  assert.ok(shorthand.diagnostics.some((item) => item.code === "VEL5038"
    && /Use 'spacing\(8px, 12px\)'/u.test(item.message)));

  const hexStrings = compile("export const bubble = look:\n    background = \"#eef0f3\"\n    color = \"#1a1a1a\"\n");
  assert.deepEqual(hexStrings.diagnostics, []);
  assert.notEqual(hexStrings.code, null);
});
