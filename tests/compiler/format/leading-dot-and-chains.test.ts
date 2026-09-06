import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile, compileProject, standardModuleApi } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("leading-dot lines continue the previous logical line across statement positions", () => {
  const returned = compile(`
def titles(items: List<string>) -> List<string>:
    return items
        .filter(value => value != "")
        .map(value => value)

let cleaned = titles(["a", "", "b"])
    .filter(value => value != "b")
print(cleaned)
print(titles(["x", ""])
    .map(value => value))
`.trimStart());
  assert.deepEqual(returned.diagnostics, []);
  const execution = executeModule(returned.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "[ 'a' ]\n[ 'x' ]\n");

  const optionalContinuation = compile(`
def measure(values: List<string>?) -> number:
    return values
        ?.size ?? 0

print(measure(null))
`.trimStart());
  assert.deepEqual(optionalContinuation.diagnostics, []);
  const optionalExecution = executeModule(optionalContinuation.code ?? "");
  assert.equal(optionalExecution.stdout, "0\n");

  // '.5' is not a member chain, so the line does not join and still reports its
  // own literal error rather than silently becoming 'a.5'. The literal now has
  // a directed spelling (D30 item 18), and the recovered '0.5' stands alone on
  // its line, so the discarded-expression rejection follows it.
  const numeric = compile("let a = 1\n.5\n");
  assert.deepEqual(numeric.diagnostics.map((item) => item.code), ["VEL1007", "VEL4030"], JSON.stringify(numeric.diagnostics));
  assert.equal(numeric.diagnostics[0]?.message, "Write '0.5'; decimal literals require a digit before the point");

  // Trailing-dot continuation stays unsupported.
  const trailing = compile("def broken(items: List<string>) -> List<string>:\n    return items.\n        filter(value => value != \"\")\n");
  assert.ok(trailing.diagnostics.some((item) => item.code === "VEL2001"), JSON.stringify(trailing.diagnostics));

  // A block header ending with ':' never joins with a dot line.
  const header = compile("def broken():\n    .run()\n");
  assert.ok(header.diagnostics.length > 0);
});

test("formatter normalizes multi-line chains one level past their statement and round-trips", () => {
  const formatted = formatSource([
    "def titles(items: List<string>) -> List<string>:",
    "    return items",
    "      .filter(value => value != \"\")",
    "            .map(value => value)",
    "",
  ].join("\n"));
  assert.equal(formatted, [
    "def titles(items: List<string>) -> List<string>:",
    "    return items",
    "        .filter(value => value != \"\")",
    "        .map(value => value)",
    "",
  ].join("\n"));
  assert.equal(formatSource(formatted), formatted);

  // Existing single-line chains are not reflowed.
  const single = "const kept = values.filter(value => value != \"\").map(value => value)\n";
  assert.equal(formatSource(single), single);
});

test("string and number methods are checked, bindable, and Unicode-aware", async () => {
  const api = standardModuleApi();
  assert.ok(["length", "char", "slice", "trim", "lower", "upper", "startsWith", "endsWith", "includes", "split", "replace", "replaceAll", "repeat", "padStart", "padEnd"]
    .every((name) => !api.modules["velar/text"]?.includes(name)));
  assert.ok(["abs", "round", "floor", "ceil", "sign", "trunc"].every((name) => !api.modules["velar/math"]?.includes(name)));

  const result = compile(`
const sample = "VelarScript"
const decimal = 3.14159
print("héllo".size)
print("a😀b".size)
print(" a😀b ".trim().upper())
print("a😀b".char(index=1) ?? "null")
print("a😀b".char(-1) ?? "null")
print("abc".char(9) ?? "null")
print("a😀bc".slice(start=1, end=3))
print("abcdef".slice(-3))
print("abcdef".slice(end=3))
print(sample.has("Script"))
print("A😀B😀".index("😀") ?? -1)
print("A😀B😀".index("😀", start=2) ?? -1)
print("A😀B😀".index(text="😀", start=-1) ?? -1)
print("A😀B😀".index("missing") ?? -1)
print("A😀B😀".index("", 99) ?? -1)
print("aaaa".count("aa"))
print("A😀B".count(""))
print("VelarScript".startsWith("Velar"))
print("VelarScript".endsWith(text="Script"))
print("a,b".split(",").join("|"))
print("a-a".replace("a", "x"))
print("a-a".replaceAll(from="a", to="x"))
print("7".padStart(3, "0"))
print("7".padEnd(size=3, fill="0"))
print("ab".repeat(2))
print(0.abs())
print((-2).abs())
print(1.5.round())
print(1.5.floor())
print(1.5.ceil())
print((-1.5).sign())
print(decimal.trunc())
print(decimal.toFixed(digits=2))

let receiverReads = 0
def title() -> string:
    receiverReads += 1
    return "Velar"
const cut = title().slice
print(cut(start=1, end=4))
const countMatches = title().count
print(countMatches(text="e"))
const locate = title().index
print(locate(text="ar", start=1) ?? -1)
print(receiverReads)
const maybe: string? = null
print(maybe?.trim() ?? "missing")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarStringSlice/u);
  assert.match(result.code ?? "", /__velarNumberToFixed/u);
  const sampleSymbol = result.semanticIndex.symbols.find((symbol) => symbol.name === "sample");
  const decimalSymbol = result.semanticIndex.symbols.find((symbol) => symbol.name === "decimal");
  assert.ok(sampleSymbol?.members.some((member) => member.name === "size" && member.kind === "field"));
  assert.ok(sampleSymbol?.members.some((member) => member.name === "trim" && member.kind === "method"));
  assert.ok(sampleSymbol?.members.some((member) => member.name === "index" && member.kind === "method"));
  assert.ok(sampleSymbol?.members.some((member) => member.name === "count" && member.kind === "method"));
  assert.ok(decimalSymbol?.members.some((member) => member.name === "toFixed" && member.kind === "method"));
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "5", "3", "A😀B", "😀", "b", "null", "😀b", "def", "abc", "true", "1", "3", "3", "-1", "4", "2", "4", "true", "true", "a|b", "x-a", "x-x", "007", "700", "abab",
    "0", "2", "2", "1", "2", "-1", "3", "3.14", "ela", "1", "3", "3", "missing", "",
  ].join("\n"));

  // Removed function forms and JavaScript spellings point at the one current method surface.
  const guided = compile(`
let word = "hello"
print(word.length)
print(word.substring(0, 2))
print(word.charAt(1))
print(word.at(-1))
print(word[0])
print(word.toUpperCase())
print(word.includes("e"))
print(word.indexOf("e"))
print((1).toString())
print(trim(word))
print(abs(1))
print(Math.sign(-1))
print(Math.trunc(1.5))
`.trimStart());
  const messages = guided.diagnostics.map((item) => item.message);
  assert.ok(messages.some((message) => /Use '\.size'/u.test(message)));
  assert.ok(messages.some((message) => /Use '\.slice\(start, end\)'/u.test(message)));
  assert.equal(messages.filter((message) => /Use '\.char\(index\)'/u.test(message)).length, 3);
  assert.ok(messages.some((message) => /Use '\.upper\(\)'/u.test(message)));
  assert.ok(messages.some((message) => /Use '\.has\(text\)'/u.test(message)));
  assert.ok(messages.some((message) => /Use '\.index\(text, start\)'/u.test(message)));
  assert.ok(messages.some((message) => /Use 'str\(value\)'/u.test(message)));
  assert.ok(messages.some((message) => /Use 'value\.trim\(\)'/u.test(message)));
  assert.ok(messages.some((message) => /Use 'value\.abs\(\)'/u.test(message)));
  assert.ok(messages.some((message) => /'sign' is a number method/u.test(message)));
  assert.ok(messages.some((message) => /'trunc' is a number method/u.test(message)));
  assert.ok(guided.diagnostics.filter((item) => item.fix?.title.startsWith("Use number method")).length === 2);

  const directory = await makeTemporaryDirectory("velar-method-guidance-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `import {trim} from "velar/text"\nimport {round} from "velar/math"\nprint(trim("x"))\nprint(round(1))\n`, "utf8");
  const project = await compileProject(entry);
  assert.ok(project.failures.some((failure) => failure.message.includes("Use 'value.trim()'")), JSON.stringify(project.failures));
  assert.ok(project.failures.some((failure) => failure.message.includes("Use 'value.round()'")), JSON.stringify(project.failures));
});

test("bare JSX for blocks and event-arrow assignments receive directive guidance", () => {
  const bareFor = compile(`
type Message:
    id: string
    text: string

component MessageList(messages: List<Message>):
    return <ul>
        for message in messages:
            <li key={message.id}>{message.text}</li>
    </ul>
`.trimStart());
  assert.ok(bareFor.diagnostics.some((item) => item.code === "VEL5049"
    && item.message.includes("Use '{messages.map((message) => ...)}'")), JSON.stringify(bareFor.diagnostics));

  const eventAssignment = compile(`
component Composer():
    state draft: string = ""
    return <input value={draft} onInput={event => draft = event.value} placeholder="Say hi" />
`.trimStart());
  const codes = eventAssignment.diagnostics.map((item) => item.code);
  assert.ok(codes.includes("VEL2028"), JSON.stringify(eventAssignment.diagnostics));
  assert.ok(eventAssignment.diagnostics.some((item) => item.code === "VEL5019" && item.message.includes("Use 'bind:value={draft}'")));
  assert.ok(eventAssignment.diagnostics.some((item) => item.code === "VEL5025" && item.message.includes("Use 'on:input'")));

  // The same guidance appears when the on: directive is already correct.
  const directive = compile(`
component Composer():
    state draft: string = ""
    return <input value={draft} on:input={event => draft = event.data} placeholder="Say hi" />
`.trimStart());
  assert.ok(directive.diagnostics.some((item) => item.code === "VEL5019" && item.message.includes("Use 'bind:value={draft}'")), JSON.stringify(directive.diagnostics));

  const statementGuidance = compile("component App():\n    state count: number = 0\n    return <p>{count = 4}</p>\n");
  assert.ok(statementGuidance.diagnostics.some((item) => item.code === "VEL2028" && /Assignment is a statement/u.test(item.message)));
});

test("multi-token Look shorthand strings are rejected with builder guidance", () => {
  const source = (entry: string): string => `component App():\n    const appearance = look:\n        ${entry}\n    return <div look={appearance}>ok</div>\n`;
  for (const [entry, guidance] of [
    ["padding = \"8px 12px\"", "Use 'spacing(8px, 12px)'"],
    ["margin = \"4px 0\"", "Use 'spacing(4px, 0px)'"],
    ["borderRadius = \"6px 12px\"", "Use 'spacing(6px, 12px)'"],
    ["border = \"1px solid #d9dce1\"", "Use 'border(1px, color(\"#d9dce1\"))'"],
    ["outline = \"2px dashed red\"", "Use 'border(2px, color(\"red\"), \"dashed\")'"],
    ["boxShadow = \"0 2px 4px #00000022\"", "Use the 'shadow(x, y, blur, color)' builder"],
    ["transition = \"opacity 0.3s ease\"", "Use 'transition(\"opacity\", 0.3s, \"ease\")'"],
  ] as const) {
    const rejected = compile(source(entry));
    assert.ok(rejected.diagnostics.some((item) => item.code === "VEL5038" && item.message.includes(guidance)),
      `${entry}: ${JSON.stringify(rejected.diagnostics)}`);
  }

  // Single-token keyword strings, hex colors, and out-of-family strings stay accepted.
  const accepted = compile(source("alignSelf = \"flex-start\"\n        marginInline = \"auto\"\n        fontWeight = \"bold\"\n        background = \"#eef0f3\"\n        fontFamily = \"Segoe UI, sans-serif\""));
  assert.deepEqual(accepted.diagnostics, []);

  // A kebab-case property recovers as its camelCase entry, so the shorthand
  // rejection and camelCase guidance co-report in one compile.
  const kebab = compile(source("border-radius = \"6px\"\n        padding = \"8px 12px\""));
  assert.ok(kebab.diagnostics.some((item) => item.code === "VEL5038" && item.message.includes("Use 'borderRadius'")));
  assert.ok(kebab.diagnostics.some((item) => item.code === "VEL5038" && item.message.includes("Use 'spacing(8px, 12px)'")));
});
