import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * D114 S7: charter section 12 rules that a class instance never satisfies a
 * record contract, and section 10 rules that behavior passes as function
 * values. The idiom the two imply is a record of bound methods, and the VEL4001
 * an author actually meets is where it gets taught. Nothing about
 * assignability moves; the message is the whole change.
 */

const terminal = [
  "type Closer:",
  "    close: () -> null",
  "",
  "class Terminal:",
  "    def close():",
  '        print("closed")',
  "",
  "def shutdown(closer: Closer):",
  "    closer.close()",
  "",
].join("\n");

function messages(source: string): { readonly code: string; readonly message: string }[] {
  return compile(source).diagnostics.map((item) => ({ code: item.code, message: item.message }));
}

test("a simple binding is read back into the record spelling", () => {
  assert.deepEqual(messages(`${terminal}const terminal = Terminal()\nshutdown(terminal)\n`), [{
    code: "VEL4001",
    message: "Cannot assign Terminal to Closer; a class instance never satisfies a record contract;"
      + " pass its behavior as bound methods — '{close: terminal.close}' — each of which binds its receiver once where it is read",
  }]);
});

test("a non-binding expression uses 'value' as the placeholder receiver", () => {
  assert.deepEqual(messages(`${terminal}shutdown(Terminal())\n`), [{
    code: "VEL4001",
    message: "Cannot assign Terminal to Closer; a class instance never satisfies a record contract;"
      + " pass its behavior as bound methods — '{close: value.close}' — each of which binds its receiver once where it is read",
  }]);
});

test("a wider contract lists three matched fields and then an ellipsis", () => {
  const source = [
    "type Terminalish:",
    "    close: () -> null",
    "    flush: () -> null",
    "    reset: () -> null",
    "    label: string",
    "",
    "class Terminal:",
    "    def close():",
    "        pass",
    "",
    "    def flush():",
    "        pass",
    "",
    "    def reset():",
    "        pass",
    "",
    "    get label() -> string:",
    '        return "t"',
    "",
    "def use(all: Terminalish) -> string:",
    "    return all.label",
    "",
    "const terminal = Terminal()",
    "print(use(terminal))",
    "",
  ].join("\n");

  assert.deepEqual(messages(source), [{
    code: "VEL4001",
    message: "Cannot assign Terminal to Terminalish; a class instance never satisfies a record contract;"
      + " pass its behavior as bound methods —"
      + " '{close: terminal.close, flush: terminal.flush, reset: terminal.reset, …}'"
      + " — each of which binds its receiver once where it is read",
  }]);
});

test("a structural record contract is taught the same way", () => {
  const source = [
    "class Terminal:",
    "    def close():",
    "        pass",
    "",
    "const terminal = Terminal()",
    "let closer = {close: () => null}",
    "closer = terminal",
    "closer.close()",
    "",
  ].join("\n");
  assert.deepEqual(messages(source).map((item) => item.message), [
    "Cannot assign Terminal to { close: () -> null }; a class instance never satisfies a record contract;"
    + " pass its behavior as bound methods — '{close: terminal.close}' — each of which binds its receiver once where it is read",
  ]);
});

test("a readonly view of the contract and an extern class instance are taught the same way", () => {
  const readonlyTarget = terminal + [
    "def useReadonly(closer: readonly Closer):",
    "    closer.close()",
    "",
    "const terminal = Terminal()",
    "useReadonly(terminal)",
    "",
  ].join("\n");
  assert.deepEqual(messages(readonlyTarget).map((item) => item.message), [
    "Cannot assign Terminal to readonly Closer; a class instance never satisfies a record contract;"
    + " pass its behavior as bound methods — '{close: terminal.close}' — each of which binds its receiver once where it is read",
  ]);

  // An extern class is registered under its bridged identity, and the idiom
  // works there too: reading `hash.digest` binds the receiver.
  const externSource = [
    'extern module "node:crypto":',
    "    export class Hash:",
    "        def digest(encoding: string) -> string",
    "",
    "    export def createHash(algorithm: string) -> Hash",
    "",
    'import js {createHash} from "node:crypto"',
    "",
    "type Digester:",
    "    digest: (string) -> string",
    "",
    "def useDigest(digester: Digester) -> string:",
    '    return digester.digest("hex")',
    "",
    'print(useDigest(createHash("sha256")))',
    "",
  ].join("\n");
  assert.deepEqual(messages(externSource).map((item) => item.message), [
    "Cannot assign Hash to Digester; a class instance never satisfies a record contract;"
    + " pass its behavior as bound methods — '{digest: value.digest}' — each of which binds its receiver once where it is read",
  ]);
  assert.deepEqual(
    compile(externSource.replace("useDigest(createHash(\"sha256\"))", "useDigest({digest: createHash(\"sha256\").digest})")).diagnostics,
    [],
    "the spelling the message names is the one that compiles",
  );
});

test("no matching name leaves the original refusal untouched", () => {
  const source = [
    "type Closer:",
    "    shutDown: () -> null",
    "",
    "class Terminal:",
    "    def close():",
    "        pass",
    "",
    "def shutdown(closer: Closer):",
    "    closer.shutDown()",
    "",
    "const terminal = Terminal()",
    "shutdown(terminal)",
    "",
  ].join("\n");
  assert.deepEqual(messages(source), [{ code: "VEL4001", message: "Cannot assign Terminal to Closer" }]);
});

test("a data-only contract stays silent: no field of it is a function type", () => {
  const source = [
    "type Named:",
    "    close: string",
    "",
    "class Terminal:",
    "    def close():",
    "        pass",
    "",
    "def label(named: Named) -> string:",
    "    return named.close",
    "",
    "const terminal = Terminal()",
    "print(label(terminal))",
    "",
  ].join("\n");
  assert.deepEqual(messages(source), [{ code: "VEL4001", message: "Cannot assign Terminal to Named" }]);
});

test("the idiom the message names compiles and executes", () => {
  const source = `${terminal}const terminal = Terminal()\nshutdown({close: terminal.close})\n`;
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  assert.notEqual(result.code, null);
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", result.code!], { encoding: "utf8" });
  assert.equal(output, "closed\n");
});
