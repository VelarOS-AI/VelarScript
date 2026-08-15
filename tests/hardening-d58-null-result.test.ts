import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// ---------------------------------------------------------------------------
// D58 rule 139 — `-> null` is written only where nothing can infer it.
//
// `-> null` is the one result annotation that names nothing a caller can use:
// a caller that ignores a result already knows as much. Both spellings used to
// compile, which is the two-spellings split this project keeps removing, so
// the written one is now refused wherever a body infers it and `velar fix`
// deletes it. The three positions with nothing to infer from — `extern`,
// `abstract`, and a function type — keep requiring it, and each is pinned
// here so a later change cannot quietly move the line.
//
// The evidence in the ledger was compile-level (a source that reported
// `clean`), so these probes are compile-level too.
// ---------------------------------------------------------------------------

function coreMessages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function webMessages(source: string, path = "app.vel"): readonly string[] {
  return compile(source, { path, extensions: [velarCompilerExtension] }).diagnostics
    .map((item) => `${item.code} ${item.message}`);
}

const REJECTION = (kind: string, name: string) =>
  `VEL4037 ${kind} '${name}' infers '-> null' from its body; delete the annotation, `
  + "and write it only where 'extern', 'abstract', or a function type leaves no body to infer";

// ---------------------------------------------------------------------------
// The three positions that must keep writing it
// ---------------------------------------------------------------------------

test("[D58-139] an abstract method has no body to infer and still declares its result", () => {
  assert.deepEqual(coreMessages("abstract class Handle:\n    abstract def close()\n"), [
    "VEL4023 Abstract method 'close' requires an explicit result annotation because it has no body to infer",
  ]);
  // Writing it is the answer the diagnostic teaches, and it stays accepted.
  assert.deepEqual(coreMessages("abstract class Handle:\n    abstract def close() -> null\n"), []);
});

test("[D58-139] an extern declaration has no body to infer and still declares its result", () => {
  assert.deepEqual(coreMessages('extern module "node:fs":\n    export def sync(path: string)\n'), [
    "VEL4023 Extern function 'sync' requires an explicit result annotation; write '-> null' when it has no result",
  ]);
  assert.deepEqual(coreMessages('extern module "node:fs":\n    export def sync(path: string) -> null\n'), []);
  // An extern class method answers the same way, through its own diagnostic.
  assert.deepEqual(coreMessages('extern module "node:fs":\n    export class Watcher:\n        def close()\n'), [
    "VEL4023 Extern method 'close' requires an explicit result annotation; write '-> null' when it has no result",
  ]);
  assert.deepEqual(coreMessages('extern module "node:fs":\n    export class Watcher:\n        def close() -> null\n'), []);
});

test("[D58-139] a function type writes its result, and '-> null' is a legal one", () => {
  assert.deepEqual(coreMessages("export type Handler = (n: number) -> null\n"), []);
  // The syntax has no shape for an omitted result: the arrow and the type are
  // both required, so this position could never have taken the deletion.
  const omitted = coreMessages("export type Handler = (n: number)\n");
  assert.ok(omitted.some((message) => message.startsWith("VEL2001")), omitted.join("\n"));
  // A function type nested in a parameter keeps it too, where the enclosing
  // declaration is a body-backed one that must drop its own.
  assert.deepEqual(coreMessages("export def register(handler: (n: number) -> null):\n    handler(1)\n"), []);
});

// ---------------------------------------------------------------------------
// The body-backed positions that must drop it
// ---------------------------------------------------------------------------

test("[D58-139] a 'def' with a body is refused the annotation its body infers", () => {
  assert.deepEqual(coreMessages("export def log(message: string) -> null:\n    print(message)\n"),
    [REJECTION("Function", "log")]);
  assert.deepEqual(coreMessages("export def log(message: string):\n    print(message)\n"), []);
  // A nested `def` and an async `def` are the same position.
  assert.deepEqual(coreMessages("def outer():\n    def inner() -> null:\n        print(\"x\")\n    inner()\n"),
    [REJECTION("Function", "inner")]);
  assert.deepEqual(coreMessages("export async def go() -> null:\n    print(\"x\")\n"),
    [REJECTION("Function", "go")]);
});

test("[D58-139] a method with a body is refused the annotation its body infers", () => {
  assert.deepEqual(coreMessages("export class Counter:\n    def bump() -> null:\n        print(\"x\")\n"),
    [REJECTION("Method", "bump")]);
  assert.deepEqual(coreMessages("export class Counter:\n    def bump():\n        print(\"x\")\n"), []);
  // `private` and `static` are the same declaration with a modifier.
  assert.deepEqual(coreMessages("export class Counter:\n    private def bump() -> null:\n        print(\"x\")\n"),
    [REJECTION("Method", "bump")]);
  assert.deepEqual(coreMessages("export class Counter:\n    static def reset() -> null:\n        print(\"x\")\n"),
    [REJECTION("Method", "reset")]);
});

test("[D58-139] an arrow function has no result annotation to write in the first place", () => {
  // The rule reaches every body-backed declaration, and an arrow is the one
  // that reaches it by construction: `=>` takes parameters straight to a body,
  // so there is no slot between them for `->`. Writing one is a parse error,
  // not a refused annotation, which is why no VEL4037 can be produced here.
  const written = coreMessages("const log = (n: number) -> null => print(n)\n");
  assert.ok(written.some((message) => message.startsWith("VEL2001")), written.join("\n"));
  assert.ok(!written.some((message) => message.startsWith("VEL4037")), written.join("\n"));
  // The contextually typed spelling is the one that exists, and the `-> null`
  // it names lives in the function type, which keeps writing it.
  assert.deepEqual(coreMessages("const log: (n: number) -> null = (n) => print(n)\nlog(1)\n"), []);
});

test("[D58-139] a Web action with a body is refused the annotation its body infers", () => {
  assert.deepEqual(webMessages("export action save() -> null:\n    print(\"x\")\n"),
    [REJECTION("Action", "save")]);
  assert.deepEqual(webMessages("export action save():\n    print(\"x\")\n"), []);
  const component = [
    "export component Counter:",
    "    state count = 0",
    "",
    "    action reset() -> null:",
    "        count = 0",
    "",
    "    return <button type=\"button\" on:click={reset}>{count}</button>",
    "",
  ].join("\n");
  assert.deepEqual(webMessages(component), [REJECTION("Action", "reset")]);
  assert.deepEqual(webMessages(component.replace(" -> null:", ":")), []);
});

// ---------------------------------------------------------------------------
// The interop case: one class writes it, the other omits it
// ---------------------------------------------------------------------------

test("[D58-139] a base that omits and a derived that writes are no longer two legal spellings", () => {
  const baseOmits = [
    "class Base:",
    "    def close():",
    "        print(\"base\")",
    "",
    "class Derived extends Base:",
    "    override def close() -> null:",
    "        print(\"derived\")",
    "",
  ].join("\n");
  // This combination compiled clean before rule 139 — the override check saw
  // one inferred `null` against one written `null` and agreed. The annotation
  // is refused on the derived side alone, and the override stays valid after
  // the deletion, so the invariant-result rule is untouched.
  assert.deepEqual(coreMessages(baseOmits), [REJECTION("Method", "close")]);
  assert.deepEqual(coreMessages(baseOmits.replace(" -> null:", ":")), []);

  // The mirror — base writes, derived omits — is refused on the base side.
  const baseWrites = [
    "class Base:",
    "    def close() -> null:",
    "        print(\"base\")",
    "",
    "class Derived extends Base:",
    "    override def close():",
    "        print(\"derived\")",
    "",
  ].join("\n");
  assert.deepEqual(coreMessages(baseWrites), [REJECTION("Method", "close")]);

  // An abstract base keeps its annotation while the concrete override drops
  // its own: the two positions differ, and the override still matches.
  assert.deepEqual(coreMessages([
    "abstract class Base:",
    "    abstract def close() -> null",
    "",
    "class Derived extends Base:",
    "    override def close():",
    "        print(\"derived\")",
    "",
  ].join("\n")), []);
});

// ---------------------------------------------------------------------------
// `velar fix` deletes it, and stops
// ---------------------------------------------------------------------------

function fixToFixpoint(source: string): { readonly text: string; readonly passes: number } {
  let text = source;
  for (let pass = 1; pass <= 8; pass += 1) {
    const applied = applyMechanicalFixes(text, compile(text).diagnostics);
    if (applied.applied.length === 0) return { text, passes: pass };
    text = applied.text;
  }
  throw new Error("velar fix did not reach a fixed point");
}

test("[D58-139] velar fix deletes the annotation and the space it stood in", () => {
  const source = "export def log(message: string) -> null:\n    print(message)\n";
  const diagnostics = compile(source).diagnostics;
  assert.equal(diagnostics[0]?.fix?.title, "Delete the inferred '-> null'");
  const fixed = applyMechanicalFixes(source, diagnostics);
  // Byte-exact: the deletion takes the arrow and the space before it, so no
  // double space is left behind for the formatter to clean up afterwards.
  assert.equal(fixed.text, "export def log(message: string):\n    print(message)\n");
  assert.equal(compile(fixed.text).diagnostics.length, 0);
});

test("[D58-139] velar fix is idempotent in both directions", () => {
  // Forward: the written spelling is rewritten once, and a second pass over
  // the result applies nothing — which is what makes a second `velar fix` a
  // no-op rather than a second edit.
  const written = "class Counter:\n    def bump() -> null:\n        print(\"x\")\n";
  const first = fixToFixpoint(written);
  assert.equal(first.text, "class Counter:\n    def bump():\n        print(\"x\")\n");
  assert.equal(first.passes, 2);
  assert.equal(applyMechanicalFixes(first.text, compile(first.text).diagnostics).applied.length, 0);

  // Backward: the omitted spelling — the one the rule requires — registers no
  // fix at all, so `velar fix` never writes the annotation back.
  const omitted = first.text;
  const back = applyMechanicalFixes(omitted, compile(omitted).diagnostics);
  assert.equal(back.applied.length, 0);
  assert.equal(back.text, omitted);

  // A source that has both spellings converges to the one spelling in a single
  // applying pass, and the positions that must keep the annotation keep it.
  const mixed = [
    "extern module \"node:fs\":",
    "    export def sync(path: string) -> null",
    "",
    "abstract class Handle:",
    "    abstract def close() -> null",
    "",
    "type Listener = (line: string) -> null",
    "",
    "class Log extends Handle:",
    "    override def close() -> null:",
    "        print(\"closed\")",
    "",
    "    def write(line: string):",
    "        print(line)",
    "",
  ].join("\n");
  const settled = fixToFixpoint(mixed);
  assert.equal(settled.text, mixed.replace("override def close() -> null:", "override def close():"));
  assert.equal(compile(settled.text).diagnostics.length, 0);
});

test("[D58-139] the redundant 'null?' spelling still converges to no annotation", () => {
  // `null?` recovers as `null`, so both this rule's deletion and the redundant
  // '?' removal name overlapping text. One is deferred, and the next pass
  // finds nothing left to do rather than fighting over the same characters.
  const settled = fixToFixpoint("def log() -> null?:\n    print(\"x\")\n");
  assert.equal(settled.text, "def log():\n    print(\"x\")\n");
});

// ---------------------------------------------------------------------------
// The accepted cost, recorded so it stays deliberate
// ---------------------------------------------------------------------------

test("[D58-139] '-> null' no longer forbids a body from returning a value", () => {
  // D58 records this cost in the open: `-> null` was a real contract that
  // rejected `return 2`, and after the rule the signature follows the body to
  // `-> number` instead. The charter already accepts that property for every
  // other annotation an author omits, so `-> null` is not special in it.
  assert.deepEqual(coreMessages("def f() -> null:\n    return 2\n"), [
    REJECTION("Function", "f"),
    "VEL4001 Cannot assign number to null",
  ]);
  const settled = fixToFixpoint("export def f() -> null:\n    return 2\n");
  assert.equal(settled.text, "export def f():\n    return 2\n");
  assert.deepEqual(compile(settled.text).moduleInterface.exports.get("f")?.kind, "function");
});

// ---------------------------------------------------------------------------
// Recursion is not an exception
// ---------------------------------------------------------------------------

test("[D58-139] a recursive group converges without needing the annotation", () => {
  // D58 checked this before making the rule hard: the one charter clause that
  // could have forced a body-backed `-> null` is the recursive fixed point,
  // and it converges in every recursion shape the language has.
  assert.deepEqual(coreMessages("def walk(n: number):\n    if n > 0:\n        walk(n - 1)\n\nwalk(3)\n"), []);
  assert.deepEqual(coreMessages([
    "def a(n: number):",
    "    if n > 0:",
    "        b(n - 1)",
    "",
    "def b(n: number):",
    "    if n > 0:",
    "        a(n - 1)",
    "",
    "a(3)",
    "",
  ].join("\n")), []);
  assert.deepEqual(coreMessages([
    "class Tree:",
    "    def walk(n: number):",
    "        if n > 0:",
    "            self.walk(n - 1)",
    "",
  ].join("\n")), []);
});

// ---------------------------------------------------------------------------
// A getter is not reached by the rule
// ---------------------------------------------------------------------------

test("[D58-139] a getter declares the property's type, which the parser requires outright", () => {
  // A getter has a body, but its result is the property's type and the parser
  // requires it (VEL2023) — there is no omitted spelling for the rule to
  // prefer, so the rule does not reach this position. D58 enumerates the
  // refused positions as `def`, method, arrow, and Web action, and lists the
  // required ones separately; a getter appears in neither, so it is pinned
  // here as it stands rather than moved.
  assert.deepEqual(coreMessages("class Box:\n    get empty() -> null:\n        return null\n"), []);
  const omitted = coreMessages("class Box:\n    get empty():\n        return null\n");
  assert.ok(omitted.includes("VEL2023 A getter requires an explicit result type"), omitted.join("\n"));
});
