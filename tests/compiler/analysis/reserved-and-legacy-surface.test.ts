import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore, formatSource, type CompilerExtension } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("compiler host capabilities stay protected while extension conveniences follow lexical scope", () => {
  const hostBindings = [
    "Array", "Boolean", "Error", "IndexError", "JSON", "Map", "Math", "NarrowingError", "Number", "RangeError", "Reflect", "Set", "String",
    "Symbol", "TypeError", "ValidationError", "WeakMap", "WeakSet", "console", "document", "globalThis", "queueMicrotask",
  ];
  for (const name of hostBindings) {
    const result = compileCore(`const ${name} = 1\n`);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3007" && item.message === `'${name}' is a reserved Core binding`), name);
  }

  const extension = compile("const mount = 1\n");
  assert.ok(extension.diagnostics.some((item) => item.code === "VEL3007" && /reserved extension binding/u.test(item.message)));
  assert.deepEqual(compileCore("const mount = 1\n").diagnostics, []);
  assert.deepEqual(compile("const color = \"brand\"\ntype Node:\n    id: string\n").diagnostics, []);

  for (const source of ["const __velarIndex = 1\n", "def run(__velarScope: number):\n    pass\n", "type __VelarRecord:\n    id: string\n", "const __velarRoot = 1\n"]) {
    const result = compile(source);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3007" && /reserved compiler prefix/u.test(item.message)));
  }

  const dollarBinding = compileCore("const $count = 2\nprint($count)\n");
  assert.deepEqual(dollarBinding.diagnostics, []);
  assert.equal(executeModule(dollarBinding.code ?? "").stdout, "2\n");
  assert.equal(formatSource("let $count=1\n"), "let $count = 1\n");

  const collidingExtension: CompilerExtension = {
    id: "test-internal-name-collision",
    analysis: { globals: new Map([["__velarValue", { kind: "number" }]]) },
  };
  assert.throws(
    () => compileCore("pass\n", { extensions: [collidingExtension] }),
    /declares invalid global '__velarValue'/u,
  );

  // N-2b: IndexError is nameable (a reserved Core binding), so a user class
  // can no longer shadow the builtin the `is` check resolves to.
  const hygienicIndex = compileCore("class IndexError:\n    constructor():\n        pass\n\nconst values = [1]\nprint(values[0])\n");
  assert.ok(hygienicIndex.diagnostics.some((item) => item.code === "VEL3007" && /'IndexError' is a reserved Core binding/u.test(item.message)));
  const indexMachinery = compileCore("const values = [1]\nprint(values[0])\n");
  assert.deepEqual(indexMachinery.diagnostics, []);
  assert.match(indexMachinery.code ?? "", /class __VelarIndexError extends __velarCollectionListNativeRangeError/u);
});

test("JavaScript reserved words stay data names but cannot become emitted bindings", () => {
  const reserved = [
    "debugger", "default", "delete", "do", "function", "implements", "instanceof", "interface", "package", "protected", "public", "typeof", "void", "yield",
  ];
  for (const name of reserved) {
    const result = compileCore(`const ${name} = 1\n`);
    assert.equal(result.code, null);
    assert.ok(
      result.diagnostics.some((item) => item.code === "VEL3007" && item.message === `'${name}' is reserved by JavaScript and cannot be used as a VelarScript binding`),
      `${name}: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  for (const source of [
    `def run(yield: number) -> number:\n    return yield\n`,
    `const {default} = {default: 1}\n`,
    `for public in [1]:\n    print(public)\n`,
  ]) {
    const result = compileCore(source);
    assert.equal(result.code, null);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3007" && /reserved by JavaScript/u.test(item.message)), JSON.stringify(result.diagnostics));
  }

  const dataNames = compileCore(`
type ProviderCall:
    arguments: string

class Operations:
    def delete() -> string:
        return "member"

const value = {default: "record"}
const call: ProviderCall = {arguments: "payload"}
print(value.default)
print(Operations().delete())
print(call.arguments)
`.trimStart());
  assert.deepEqual(dataNames.diagnostics, []);
  const execution = executeModule(dataNames.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "record\nmember\npayload\n");

  const argumentsBinding = compileCore("const arguments = []\n");
  assert.ok(argumentsBinding.diagnostics.some((item) => item.code === "VEL3007" && /named parameters.*arguments/u.test(item.message)));
});

test("rejects legacy and discarded design surface with intentional diagnostics", () => {
  const cases = new Map([
    ["var value = 1\n", /let.*const.*var/],
    ["const value = undefined\n", /null.*undefined/],
    ["const value = this\n", /self.*this/],
    ["const value = new Player()\n", /directly.*new/],
    ["eval(\"1\")\n", /does not expose 'eval'/],
    // D89 (message correction): 'with' is Python's context manager, and the
    // successor is the binding that owns and releases a value.
    ["with value\n", /Use 'using name = expression'.*releases it when the scope ends.*does not expose 'with'/],
    ["const value = Player.prototype\n", /prototype manipulation/],
    ["const value = item.__proto__\n", /prototype manipulation/],
    ["const value = 1 === 1\n", /equality is already strict/],
    ["const value = 1 !== 2\n", /inequality is already strict/],
    ["const value = True\n", /Use 'true'.*lowercase/],
    ["const value = False\n", /Use 'false'.*lowercase/],
    ["const value: int = 1\n", /Use 'number'.*numeric type/],
    ["if true:\n    pass\nelif false:\n    pass\n", /Use 'else if'/],
    ["const value = true && false\n", /Use 'and'.*readable logical/],
    ["const value = true || false\n", /Use 'or'.*readable logical/],
    ["const value = !false\n", /Use 'not'.*readable logical/],
    ["effect count:\n    print(count)\n", /internal to @velarscript\/web.*watch.*mounted.*cleanup/],
    ["onMounted()\n", /component-level '@mounted:'/],
  ]);

  for (const [source, message] of cases) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.ok(
      result.diagnostics.some((item) => item.code === "VEL1005" && message.test(item.message)),
      `${source}: ${JSON.stringify(result.diagnostics)}`,
    );
  }
});

test("keeps JavaScript-only operations and private identifiers out of the Velar AST", () => {
  // 'delete x.y' and 'typeof x' recover into an expression whose result is
  // discarded, so each also reports the pure-expression rejection (VEL4030) —
  // the recovered spelling stays first and stays exact.
  const cases = new Map([
    ["let row = {value: 1}\ndelete row.value\n", [/does not expose JavaScript 'delete'/u, ["VEL2031", "VEL4030"]] as const],
    ["let value = 1\ntypeof value\n", [/does not expose JavaScript 'typeof'/u, ["VEL2031", "VEL4030"]] as const],
    ["class Box:\n    pass\nlet value = Box()\nprint(value instanceof Box)\n", [/does not expose JavaScript 'instanceof'/u, ["VEL2031"]] as const],
    ["class Box:\n    private let value: number = 1\n    def read() -> number:\n        return self.#value\n", [/does not expose JavaScript private identifiers/u, ["VEL1005"]] as const],
    ["class Box:\n    private let #value: number = 1\n", [/does not expose JavaScript private identifiers/u, ["VEL1005"]] as const],
  ]);
  for (const [source, [message, codes]] of cases) {
    const result = compileCore(source);
    assert.equal(result.code, null, source);
    assert.deepEqual(result.diagnostics.map((item) => item.code), codes, `${source}: ${JSON.stringify(result.diagnostics)}`);
    assert.match(result.diagnostics[0]!.message, message);
  }

  for (const source of [
    "let value = 1\nvalue++\n",
    "let value = 1\nvalue--\n",
    "const pattern = /abc/\n",
  ]) {
    const result = compileCore(source);
    assert.equal(result.code, null, source);
    assert.ok(result.diagnostics.length > 0, source);
  }

  const color = compileCore("const color = #abc\n");
  assert.equal(color.diagnostics.length, 1);
  assert.match(color.diagnostics[0]!.message, /writes hex colors as quoted strings/u);

  const dataMembers = compileCore(`
type Payload:
    delete: string
    default: string
    arguments: string

const payload: Payload = {delete: "remove", default: "fallback", arguments: "data"}
print(payload.delete)
print(payload.default)
print(payload.arguments)
`.trimStart());
  assert.deepEqual(dataMembers.diagnostics, []);
  assert.equal(executeModule(dataMembers.code ?? "").stdout, "remove\nfallback\ndata\n");
});
