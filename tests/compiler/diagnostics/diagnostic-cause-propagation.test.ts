import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

const messages = (source: string) => compile(source.trimStart()).diagnostics.map((item) => item.message);

test("an invalid iterable poisons both loop slots without hiding an independent body error", () => {
  for (const value of ["true", "42", "{a: 1}"]) {
    const source = `@main:\n    for item, index in ${value}:\n        print(item.field)\n        print(index + 1)\n        print(str(item))\n`;
    const reports = messages(source);
    assert.equal(reports.length, 1, JSON.stringify(reports));
    assert.match(reports[0]!, /^Cannot iterate over /);
    const independent = messages(source + '    print(notDeclaredHere)\n');
    assert.equal(independent.length, 2, JSON.stringify(independent));
    assert.ok(independent.some((message) => message.includes("Unknown name 'notDeclaredHere'")));
  }
});

test("non-convergent recursive results do not create text-conversion errors at callers", () => {
  for (const source of [
    'def loop(n: number):\n    return loop(n)\n\n@main:\n    print(str(loop(1)))\n',
    'def display():\n    print(str(loop(1)))\n\ndef loop(n: number):\n    return loop(n)\n',
  ]) {
    const reports = compile(source).diagnostics;
    assert.deepEqual(reports.map((item) => item.code), ["VEL4025"]);
  }
});

test("positional arity failures do not check shifted slots or fabricate a result", () => {
  for (const call of ['m.update("a", value => value + 1)', 'Promise.all()', '"abc".slice(1, 2, 3)']) {
    const reports = messages(`@main:\n    const m = Map({a: 1})\n    print(str(${call}))\n`);
    assert.equal(reports.length, 1, JSON.stringify(reports));
    assert.match(reports[0]!, /^Expected .*arguments? but received /);
  }
  assert.deepEqual(messages('def one(value: string) -> string:\n    return value\n\n@main:\n    print(str(one(1, 2).title))\n'), [
    "Expected 1 argument but received 2",
  ]);
});

test("an arity mistake preserves errors inside explicitly typed values and unknown names", () => {
  const reports = messages('def one(value: string) -> string:\n    return value\n\n@main:\n    one(unknownValue, (x: number) => x + "bad")\n');
  assert.equal(reports.length, 3, JSON.stringify(reports));
  assert.ok(reports.some((message) => message.includes("Unknown name 'unknownValue'")));
  assert.ok(reports.some((message) => message.includes("String concatenation requires two strings")));
});

test("valid variadic namespace calls and the Map.get migration keep their contracts", () => {
  assert.deepEqual(messages('@main:\n    print(Math.min(1, 2, 3) + Math.max(1, 2, 3))\n'), []);
  assert.deepEqual(messages('@main:\n    const m = Map({a: 1})\n    print(str(m.get("a", 0)))\n'), [
    "Use 'get(key) ?? fallback'; Map.get has one optional-result contract",
  ]);
});

test("special named-call families propagate their invalid plans", () => {
  for (const call of [
    'range(starp=1, end=2)', 'Map(soruce={a: 1})', 'Set(soruce=[1])',
    'equals(aa=1, b=1)', 'User.from(soruce={age: 1})', 'User.mapFrom(soruce={age: 1}, transform=value => value)',
  ]) {
    const reports = messages(`type User:\n    age: number\n\n@main:\n    print(str(${call}))\n`);
    assert.equal(reports.length, 1, JSON.stringify(reports));
    assert.match(reports[0]!, /^Unknown named argument /);
  }
});

test("literal contracts wait for a valid call plan and consume named parameter order", () => {
  for (const call of ['"abc".char(-1, 2)', 'Text.findMatch("a", "([", {}, 4)', 'Text.findMatch(expression="([")']) {
    const reports = messages(`@main:\n    print(str(${call}))\n`);
    assert.equal(reports.length, 1, JSON.stringify(reports));
    assert.match(reports[0]!, /^(Expected |Missing required named argument)/);
  }
  assert.deepEqual(messages('@main:\n    print(Text.findMatch(expression="a", value="(["))\n'), []);
  const invalid = messages('@main:\n    print(Text.findMatch(expression="([", value="a"))\n');
  assert.equal(invalid.length, 1, JSON.stringify(invalid));
  assert.match(invalid[0]!, /^Invalid text pattern/);
});
