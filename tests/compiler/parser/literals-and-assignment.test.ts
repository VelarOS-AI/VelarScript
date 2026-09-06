import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("contextual record returns preserve positional callable contracts", () => {
  const result = compile(`
type Composer:
    text: (string, string) -> string
    update: (string) -> null

def createComposer() -> Composer:
    return {
        text: (english, chinese) => english + chinese,
        update: value => print(value),
    }

const composer = createComposer()
print(composer.text("Velar", "Script"))
composer.update("ready")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "VelarScript\nready\n");
});

test("compound index assignment evaluates its receiver and key once", () => {
  const result = compile(`
let receiverCalls = 0
let keyCalls = 0
let values = [10]

def receiver() -> List<number>:
    receiverCalls += 1
    return values

def key() -> number:
    keyCalls += 1
    return 0

receiver()[key()] += 5
print(receiverCalls)
print(keyCalls)
print(values[0])
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1\n1\n15\n");
});

test("self-negating assignment reverses writable bool targets with ordinary evaluation", () => {
  const result = compile(`
let active = false
let receiverCalls = 0
let keyCalls = 0
let values: List<bool> = [false]

class Switch:
    constructor(private let enabled: bool):
        pass

    def flip() -> bool:
        self.enabled = not self.enabled
        return self.enabled

def receiver() -> List<bool>:
    receiverCalls += 1
    return values

def key() -> number:
    keyCalls += 1
    return 0

active = not active
const toggle = Switch(false)
print(active)
print(toggle.flip())
receiver()[key()] = not receiver()[key()]
print(receiverCalls)
print(keyCalls)
print(values[0])
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /active = !\(active\);/u);
  // Ordinary read-modify-write: the receiver and index evaluate on each
  // side, exactly like JavaScript and Python (D28 item 7).
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\n2\n2\ntrue\n");
  assert.equal(formatSource("let active=false\nactive=not    active\n"), "let active = false\nactive = not active\n");
});

test("self-negating assignment follows ordinary assignment checking and 'invert' is an ordinary name", () => {
  const nonWritable = compile("const fixed = false\nfixed = not fixed\n");
  assert.equal(nonWritable.code, null);
  assert.deepEqual(nonWritable.diagnostics.map((item) => item.code), ["VEL3002"]);

  const legalFlips = compile(`
type Box:
    active: bool

let active = false
let box: Box = {active: false}

def current() -> Box:
    return box

active = not active
box.active = not box.active
current().active = not current().active
print(active)
print(box.active)
`.trimStart());
  assert.deepEqual(legalFlips.diagnostics, []);
  const execution = executeModule(legalFlips.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\n");

  const ordinaryName = compile(`
def invert(value: bool) -> bool:
    return not value

print(invert(false))
`.trimStart());
  assert.deepEqual(ordinaryName.diagnostics, []);
  const named = executeModule(ordinaryName.code ?? "");
  assert.equal(named.status, 0, String(named.stderr));
  assert.equal(named.stdout, "true\n");
  assert.equal(formatSource("print(invert(false))\n"), "print(invert(false))\n");

  // MIG-4: the removed 'invert x' statement is steered to the assignment that
  // replaced it instead of falling into the generic statement-boundary message,
  // and the reflex consumes only that line.
  const removedName = compile("let ready = false\ninvert ready\nlet after = 7\n");
  assert.equal(removedName.code, null);
  assert.deepEqual(removedName.diagnostics.map((item) => item.code), ["VEL2033"]);
  assert.equal(removedName.diagnostics[0]?.message, "Use 'ready = not ready'; the 'invert' statement was removed");
  assert.ok(removedName.semanticIndex.symbols.some((item) => item.name === "after"));

  const removedMember = compile("type Box:\n    active: bool\nlet box: Box = {active: false}\ninvert box.active\n");
  assert.deepEqual(
    removedMember.diagnostics.map((item) => item.message),
    ["Use 'box.active = not box.active'; the 'invert' statement was removed"],
  );

  const removedIndex = compile("let flags = [true]\ninvert flags[0]\n");
  assert.deepEqual(
    removedIndex.diagnostics.map((item) => item.message),
    ["Use 'x = not x'; the 'invert' statement was removed"],
  );
});

test("numeric literals support familiar exponents and reject non-finite overflow", () => {
  const valid = compileCore(`
print(1e3)
print(2.5E-2)
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1000\n0.025\n");
  assert.equal(formatSource("const value=1e3\n"), "const value = 1e3\n");

  const overflow = compileCore(`const value = ${"9".repeat(400)}\n`);
  assert.ok(overflow.diagnostics.some((item) => item.code === "VEL2017" && item.message === "Numeric literals must be finite"));
  assert.equal(overflow.code, null);
});

test("interpolated strings balance nested expressions and keep escapes in text", () => {
  const result = compile(`
const name = "Ada"
print(f"{({name}).name} {{ready}} {"}"}\\nnext")
print(f"same quote: {"ready"}")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada {ready} }\nnext\nsame quote: ready\n");

  const unmatched = compile("print(f\"value }\")\n");
  assert.ok(unmatched.diagnostics.some((item) => item.message === "Unmatched '}' in interpolated string"));

  const formattedSource = 'print(f"{"x"}tail")\n';
  assert.equal(formatSource(formattedSource), formattedSource);
  const formattedExecution = executeModule(compile(formatSource(formattedSource)).code ?? "");
  assert.equal(formattedExecution.status, 0, String(formattedExecution.stderr));
  assert.equal(formattedExecution.stdout, "xtail\n");

  const spacedSource = 'const left = "Velar"\nconst right = "Script"\nprint(f"{left+right}: {({name:right}).name} {{ready}}")\n';
  const spacedFormatted = formatSource(spacedSource);
  assert.equal(spacedFormatted, 'const left = "Velar"\nconst right = "Script"\nprint(f"{left + right}: {({name: right}).name} {{ready}}")\n');
  assert.equal(formatSource(spacedFormatted), spacedFormatted);
  const spacedExecution = executeModule(compile(spacedFormatted).code ?? "");
  assert.equal(spacedExecution.status, 0, String(spacedExecution.stderr));
  assert.equal(spacedExecution.stdout, "VelarScript: Script {ready}\n");
});

test("inline strings recover at newlines while layout strings recover at dedent", () => {
  for (const literal of ['"unfinished', 'f"unfinished', 'r"unfinished', 'rf"unfinished']) {
    const result = compile(`const broken = ${literal}\r\nconst recovered = 7\r\n`);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL1003"));
    assert.ok(result.semanticIndex.symbols.some((item) => item.name === "recovered"));
  }

  const brokenLayout = compile('const broken = "\n    unfinished\nconst recovered = 7\n');
  assert.ok(brokenLayout.diagnostics.some((item) => item.code === "VEL1003" && /layout string/u.test(item.message)));
  assert.ok(brokenLayout.semanticIndex.symbols.some((item) => item.name === "recovered"));
});
