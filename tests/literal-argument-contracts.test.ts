import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * TX-U3: a literal argument meets its runtime contract at compile time.
 *
 * `"ab".repeat(-1)`, `"abc".char(1.5)` and `Text.findMatch(value, "([")` are
 * decided the moment they are written — the argument is a literal and the
 * contract is the compiler's own — so running the program only delays the same
 * sentence. Nothing here changes what a program means: the message is the
 * runtime guard's own, and a computed argument still reaches that guard.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[TX-U3] a literal count, index and pattern are checked where they are written", () => {
  assert.deepEqual(messages(`
@main:
    print("ab".repeat(-1))
`), ["VEL4001 String.repeat count must be an integer from 0 through 16777216"]);

  assert.deepEqual(messages(`
@main:
    print("abc".char(1.5) ?? "")
`), ["VEL4001 String.char index must be an integer"]);

  assert.deepEqual(messages(`
@main:
    print(f"{Text.findMatch("x", "([") != null}")
`), ["VEL4001 Invalid text pattern: Unterminated character class"]);
});

test("[TX-U3] the neighbours in the same family answer the same way", () => {
  assert.deepEqual(messages(`
@main:
    print("abc".slice(0.5, 2))
`), ["VEL4001 String.slice positions must be integers"]);

  assert.deepEqual(messages(`
@main:
    print("abc".padStart(-2, "-"))
`), ["VEL4001 String.padStart size must be an integer from 0 through 16777216"]);

  assert.deepEqual(messages(`
@main:
    print(f"{Text.matches("x", "(") }")
`), ["VEL4001 Invalid text pattern: Unterminated group"]);
});

test("[TX-U3] legal literals compile clean", () => {
  assert.deepEqual(messages(`
@main:
    print("ab".repeat(3))
    print("abc".char(1) ?? "")
    print("abc".slice(0, 2))
    print("abc".padStart(5, "-"))
    print(f"{Text.findMatch("x", "[a-z]") != null}")
`), []);
});

test("[TX-U3] a computed argument is left to the runtime guard", () => {
  assert.deepEqual(messages(`
def size() -> number:
    return -1

def pattern() -> string:
    return "(["

@main:
    print("ab".repeat(size()))
    print(f"{Text.findMatch("x", pattern()) != null}")
`), []);
});

test("[TX-U3] 'Text' names the namespace and nothing else, so the check has one receiver", () => {
  // The lookup guard in `inferCall` is belt and braces: `Text` is a reserved
  // Core binding, so no local can stand in front of the namespace here.
  assert.deepEqual(messages(`
@main:
    const Text = 1
    print(f"{Text}")
`), ["VEL3007 'Text' is a reserved Core binding"]);
});
