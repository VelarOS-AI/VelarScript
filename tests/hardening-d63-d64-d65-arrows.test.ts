import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { standardModuleInterfaces } from "../packages/cli/src/standard-modules.ts";

// ---------------------------------------------------------------------------
// D63 rule 161, D64 rules 163/164/165, D65 rules 170/171 — the arrows, the
// contextual keywords the parser was claiming too early, and the two shapes a
// contextual type was not reaching.
//
// The thread running through them is one criterion, D42's: **a pile of
// cascades with no right answer in it is no diagnostic**, and its sibling —
// a rule stated without its scope is a rule the language will refuse an author
// for obeying. Each probe below is execution-level, because the ledger
// evidence for every one of these was a compile of a source file.
// ---------------------------------------------------------------------------

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function webMessages(source: string, path = "app.vel"): readonly string[] {
  return compile(source, { path, extensions: [velarCompilerExtension] }).diagnostics
    .map((item) => `${item.code} ${item.message}`);
}

// ---------------------------------------------------------------------------
// D63 rule 161 — `=>` in a type position gets one diagnostic that says `->`
// ---------------------------------------------------------------------------

const FAT_ARROW_IN_TYPE =
  "VEL2012 A function type writes its result after '->'; "
  + "'=>' is the value-level arrow that introduces a lambda body";

test("[D63-161] a function type written with '=>' gets one diagnostic, and it names '->'", () => {
  // The blind test's spelling, in Core. Before this rule it produced
  // `Expected ')' after grouped type` and five cascades, not one of which
  // contained the characters `->`.
  assert.deepEqual(messages("def go(onAdd: (string, string) => Promise<null>):\n    pass\n"), [FAT_ARROW_IN_TYPE]);

  // The same mistake in the other type positions, each still exactly one
  // diagnostic: a binding annotation, a record field, a type alias, a result
  // type, and a type argument.
  for (const source of [
    "const f: (number) => number = (x: number) => x\n",
    "type Handler:\n    onAdd: (string, string) => null\n",
    "type Handler = (string) => number\n",
    "def make() -> (number) => number:\n    return (x: number) => x\n",
    "const values: List<(number) => number> = []\n",
  ]) {
    assert.deepEqual(messages(source), [FAT_ARROW_IN_TYPE], source);
  }
});

test("[D63-161] the diagnostic carries the rewrite, and applying it leaves a clean module", () => {
  const source = "export def go(onAdd: (string, string) -> Promise<null>):\n    pass\n";
  const wrong = source.replace("(string, string) ->", "(string, string) =>");
  const [refusal] = compile(wrong).diagnostics;
  assert.equal(refusal?.code, "VEL2012");
  assert.deepEqual(refusal?.fix?.title, "Use '->' in a function type");
  const fixed = applyMechanicalFixes(wrong, compile(wrong).diagnostics);
  assert.equal(fixed.text, source);
  assert.deepEqual(compile(fixed.text).diagnostics, []);
});

test("[D63-161] a component prop is the position the blind test hit, and it answers the same way", () => {
  assert.deepEqual(webMessages([
    "component Form(onAdd: (string, string) => Promise<null>):",
    "    return <div>form</div>",
    "",
  ].join("\n")), [FAT_ARROW_IN_TYPE]);
});

test("[D63-161] the value-level arrow is untouched, and a correct function type still compiles", () => {
  assert.deepEqual(messages("const double = (x: number) => x * 2\nprint(str(double(2)))\n"), []);
  assert.deepEqual(messages("const f: (number) -> number = (x: number) => x\nprint(str(f(1)))\n"), []);
  // A *grouped* type in parentheses is still a grouped type: nothing follows
  // the closing paren, so the scan that now accepts `=>` never fires.
  assert.deepEqual(messages("const value: (string)? = null\nprint(str(value == null))\n"), []);
});

// ---------------------------------------------------------------------------
// D64 rule 163 — the async result annotation is spelled two ways, and both
// positions now say which one they are
// ---------------------------------------------------------------------------

test("[D64-163] the declaration rule states its scope", () => {
  assert.deepEqual(messages("async def load(id: string) -> Promise<string>:\n    return id\n"), [
    "VEL4018 An async result annotation in a declaration names the resolved value; write '-> T', not '-> Promise<T>'",
  ]);
  // The four declaration positions that report it say the same sentence, so a
  // reader who meets one has met all of them.
  const scoped = (source: string) => messages(source).filter((item) => item.startsWith("VEL4018"));
  const sentence = ["VEL4018 An async result annotation in a declaration names the resolved value; write '-> T', not '-> Promise<T>'"];
  assert.deepEqual(scoped("class C:\n    async def load() -> Promise<string>:\n        return \"a\"\n"), sentence);
  assert.deepEqual(scoped('extern module "node:fs":\n    export async def read(path: string) -> Promise<string>\n'), sentence);
  assert.deepEqual(scoped('extern module "node:fs":\n    export class Reader:\n        async def read() -> Promise<string>\n'), sentence);
  assert.deepEqual(scoped("abstract class Base:\n    abstract async def load() -> Promise<string>\n"), sentence);
});

test("[D64-163] the type position teaches the spelling it wants instead of only naming the mismatch", () => {
  assert.deepEqual(messages("const load: (id: string) -> string = async (id: string) => id\n"), [
    "VEL4001 Cannot assign (id: string) -> Promise<string> to (id: string) -> string; "
    + "an async function's type describes the value the call produces, so its result is a Promise — "
    + "write '-> Promise<string>' here, and '-> string' on the 'async def' declaration itself",
  ]);
  // Both spellings, side by side, in the state the two diagnostics guide to.
  assert.deepEqual(messages([
    "async def loadUser(id: string) -> string:",
    "    return id",
    "",
    "const named: (id: string) -> Promise<string> = loadUser",
    "const inline: (id: string) -> Promise<string> = async (id: string) => id",
    "",
    "async def run():",
    "    print(await named(\"a\") + await inline(\"b\"))",
    "",
  ].join("\n")), []);
});

test("[D64-163] the guidance appears only where the result spelling is the whole quarrel", () => {
  const guided = (source: string) => messages(source).some((item) => item.includes("async function's type"));
  // A parameter mismatch alongside the result mismatch is a different repair,
  // so the sentence that would name `-> Promise<T>` as *the* answer stays out.
  assert.ok(!guided("const load: (id: number) -> string = async (id: string) => id\n"));
  // A plain non-async mismatch is untouched.
  assert.ok(!guided("const load: (id: string) -> string = (id: string) => 1\n"));
  assert.deepEqual(messages("const load: (id: string) -> string = (id: string) => 1\n"), [
    "VEL4001 Cannot assign (id: string) -> number to (id: string) -> string",
  ]);
  // An unannotated target result has nothing to contrast with, so no guidance.
  assert.ok(!guided("const load: (id: string) -> unknown = async (id: string) => id\n"));
});

// ---------------------------------------------------------------------------
// D64 rules 164/165 — two contextual keywords the parser claimed by the word
// rather than by the shape
// ---------------------------------------------------------------------------

test("[D64-164] 'readonly' followed by ':' is a record field of that name", () => {
  assert.deepEqual(messages("type Holder:\n    readonly: number\n\nconst h: Holder = {readonly: 1}\nprint(str(h.readonly))\n"), []);
  // The value side already read it this way, which is what made the record
  // *type* the odd one out.
  assert.deepEqual(messages("const h = {readonly: 1}\nprint(str(h.readonly))\n"), []);
  // The modifier shape is `readonly` followed by a *name*, and it still is —
  // including over a field that is itself named `readonly`.
  assert.deepEqual(messages([
    "type Holder:",
    "    readonly readonly: number",
    "",
    "def replace(h: Holder) -> number:",
    "    h.readonly = 2",
    "    return h.readonly",
    "",
  ].join("\n")), ["VEL3002 Cannot assign to read-only field 'readonly'"]);
  // And the ordinary modifier over an ordinary name is unchanged.
  assert.deepEqual(messages("type Holder:\n    readonly tags: List<string>\n\nconst h: Holder = {tags: [\"a\"]}\nprint(str(h.tags.size))\n"), []);
});

test("[D64-165] a record shorthand in an arrow body is a record, whatever the word is", () => {
  // `{` after `=>` opens a record (charter §7). The brace scan used to read
  // `match` as statement evidence because the token after it is `}` rather
  // than ':', so the one contextual keyword with a statement shape was the one
  // the shorthand refused.
  for (const word of ["match", "case", "type", "test", "using", "as", "from", "get", "readonly", "constructor"]) {
    const source = `const ${word} = 1\nconst build = () => {${word}}\nprint(str(build().${word}))\n`;
    assert.deepEqual(messages(source), word === "case"
      // `case` cannot be *bound*, which is charter §3's stated exception and
      // has nothing to do with the brace scan.
      ? ["VEL3007 'case' is reserved by JavaScript and cannot be used as a VelarScript binding"]
      : [], source);
  }
  // The next field separator answers the same way as the closing brace.
  assert.deepEqual(messages("const match = 1\nconst type = 2\nconst build = () => {match, type}\nprint(str(build().match))\n"), []);
  assert.deepEqual(messages("const match = 1\nconst build = () => {match, id: 2}\nprint(str(build().match))\n"), []);
});

test("[D64-165] a real statement body after '=>' is still refused, and 'match' is still a statement", () => {
  // The other direction: the scan has to keep answering "statements" for the
  // thing it exists to catch, or the fix would have traded one defect for a
  // worse one.
  const arrowBody = "An arrow body is a single expression; write the expression directly "
    + "or move multi-statement logic into a named 'def'";
  assert.deepEqual(messages("const f = (x: number) => {const y = x\nreturn y}\n").slice(0, 1), [`VEL2030 ${arrowBody}`]);
  assert.deepEqual(messages("const f = (x: number) => {return x}\n").slice(0, 1), [`VEL2030 ${arrowBody}`]);
  assert.deepEqual(messages("const f = (x: number) => {match x}\n").slice(0, 1), [`VEL2030 ${arrowBody}`]);
  // And `match` as a statement head is untouched.
  assert.deepEqual(messages([
    "def pick(n: number) -> number:",
    "    match n:",
    "        case 1:",
    "            return 2",
    "        case _:",
    "            return 3",
    "",
    "print(str(pick(1)))",
    "",
  ].join("\n")), []);
});

// ---------------------------------------------------------------------------
// D65 rule 170 — a rest parameter is contextually typed, like the fixed
// parameters standing beside it
// ---------------------------------------------------------------------------

const REST_REFUSAL = "VEL2016 A rest parameter requires an element type";

test("[D65-170] a contextual function type's rest supplies the element type", () => {
  assert.deepEqual(messages("const total: (...values: number) -> number = (...values) => values.sum()\nprint(str(total(1, 2, 3)))\n"), []);
  // Fixed and rest in one list, which is the asymmetry the ruling named: the
  // author could not see why one half was typed and the other was refused.
  assert.deepEqual(messages([
    "const total: (base: number, ...values: number) -> number = (base, ...values) => base + values.sum()",
    "print(str(total(10, 1, 2)))",
    "",
  ].join("\n")), []);
  // The element type the context supplied is the contextual one and not
  // `unknown`, so a use that contradicts it still fails.
  assert.deepEqual(messages("const bad: (...values: number) -> number = (...values) => values.join(\",\")\n"), [
    "VEL4001 Cannot assign (...number) -> string to (...number) -> number",
    "VEL4001 List.join requires List<string>, received List<number>",
  ]);
  assert.deepEqual(messages("const texts: (...values: string) -> string = (...values) => values.join(\",\")\nprint(texts(\"a\", \"b\"))\n"), []);
});

test("[D65-170] with no context the refusal is the same sentence it always was", () => {
  assert.deepEqual(messages("const total = (...values) => values.size\n"), [REST_REFUSAL]);
  // A contextual type that is not a function, or one whose rest is absent,
  // supplies nothing and lands in the same place.
  assert.deepEqual(messages("const total: (values: number) -> number = (...values) => values.size\n")
    .filter((item) => item.startsWith("VEL2016")), [REST_REFUSAL]);
  // A declaration has no context by construction, and is refused where it
  // always was — at parse time, before analysis runs.
  assert.deepEqual(messages("def total(...values) -> number:\n    return values.size\n"), [REST_REFUSAL]);
  assert.deepEqual(messages("class C:\n    def total(...values) -> number:\n        return values.size\n"), [REST_REFUSAL]);
  assert.ok(messages('extern module "node:path":\n    export def join(...parts) -> string\n').includes(REST_REFUSAL));
  // An explicit annotation on the arrow still wins over the context.
  assert.deepEqual(messages("const total: (...values: number) -> number = (...values: number) => values.sum()\nprint(str(total(1)))\n"), []);
});

test("[D65-170] the contextually typed rest reaches the emitter and runs", () => {
  const result = compile([
    "export const total: (base: number, ...values: number) -> number = (base, ...values) => base + values.sum()",
    "export const answer = total(10, 1, 2, 3)",
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.code?.includes("...") === true, result.code ?? "no code was emitted");
});

// ---------------------------------------------------------------------------
// D65 rule 171 — `velar/log` publishes the type its own callback receives
// ---------------------------------------------------------------------------

test("[D65-171] velar/log exports LogRecord as a type name", () => {
  const log = standardModuleInterfaces().get("velar/log");
  assert.ok(log, "velar/log is not a standard module");
  assert.deepEqual(log.exports.get("LogRecord"), { kind: "typeObject", name: "LogRecord" });
  // The published name and the type `useSink` actually asks for are one
  // object, so they cannot drift into two shapes with one name.
  const alias = log.typeAliases.get("LogRecord");
  assert.equal(alias?.kind, "object");
  const sink = log.exports.get("useSink");
  assert.equal(sink?.kind, "function");
  const callback = sink?.kind === "function" ? sink.parameters[0] : null;
  assert.equal(callback?.kind, "function");
  assert.equal(callback?.kind === "function" ? callback.parameters[0] : null, alias);
  assert.deepEqual(
    alias?.kind === "object" ? [...alias.fields.keys()] : null,
    ["timestamp", "level", "scope", "message", "fields", "error"],
  );
});
