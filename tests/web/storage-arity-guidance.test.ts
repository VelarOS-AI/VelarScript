import assert from "node:assert/strict";
import test from "node:test";
import { compile, standardModuleInterface } from "../support/compiler-suite.ts";

const imports = standardModuleInterface("velar/storage")!.exports;
const checked = (body: string) => compile(`import {storage, session, database} from "velar/storage"\n${body}\n`, { analysis: { imports } });

test("missing runtime types retain the owner recipe across storage, scopes, database and watch", () => {
  for (const receiver of ["storage", "session", 'storage.scope("profile")', 'session.scope("profile")', 'database("profile")']) {
    const calls = [`${receiver}.get("reading")`];
    if (!receiver.startsWith("database")) calls.push(`${receiver}.watch("reading")`);
    for (const call of calls) {
      const result = checked(`print(str(${call}.field))`);
      assert.equal(result.code, null);
      assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
      const message = result.diagnostics[0]!.message;
      assert.match(message, /validates what it reads and parses the stored JSON itself/u);
      assert.match(message, /type SavedItems = List<Item>/u);
      assert.match(message, /storage\.get\("items", SavedItems, \[\]\)/u);
      assert.match(message, /storage\.set\("items", items\)/u);
      if (receiver.startsWith("database")) assert.match(message, /^database\(name\)\.get/u);
      else if (call.includes(".watch(")) assert.match(message, /^storage\.watch/u);
      else assert.match(message, /^storage\.get/u);
    }
  }
});

test("storage shape rejection keeps independent argument errors without shifted-slot diagnostics", () => {
  for (const call of ['storage.get(unknownKey)', 'database("profile").get(unknownKey)', 'storage.watch(unknownKey)']) {
    const result = checked(`print(str(${call}))`);
    assert.equal(result.diagnostics.length, 2, JSON.stringify(result.diagnostics));
    assert.match(result.diagnostics[0]!.message, /validates what it reads/u);
    assert.match(result.diagnostics[1]!.message, /Unknown name 'unknownKey'/u);
  }
  const typed = checked('print(str(storage.get((value: number) => value + "bad")))');
  assert.equal(typed.diagnostics.length, 2, JSON.stringify(typed.diagnostics));
  assert.match(typed.diagnostics[1]!.message, /String concatenation requires two strings/u);
  const implicit = checked('print(str(storage.get(value => value.field)))');
  assert.equal(implicit.diagnostics.length, 1, JSON.stringify(implicit.diagnostics));
});

test("other storage shape failures retain their own arity or named-plan cause", () => {
  for (const call of ['storage.get("reading", Saved, "", 1, 2)', 'storage.watch("reading", Saved)', 'storage.set("reading")']) {
    const result = checked(`type Saved = string\nprint(str(${call}))`);
    assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
    assert.match(result.diagnostics[0]!.message, /^Expected .*arguments? but received /u);
  }
  const named = checked('print(str(storage.get(key="reading")))');
  assert.equal(named.diagnostics.length, 1, JSON.stringify(named.diagnostics));
  assert.equal(named.diagnostics[0]!.message, "Missing required named argument: target");
});

test("valid storage types and recipes still infer their actual results", () => {
  const result = checked(`type Saved = string
@main:
    const local: string = storage.get("reading", Saved, "")
    const tab: string = session.get("reading", Saved, "")
    const scoped: string = storage.scope("profile").get("reading", Saved, "")
    const stored: string = await database("profile").get("reading", Saved, "")
    const stop = storage.watch("reading", Saved, (value, previous) => print(value))
    stop()
    print(local + tab + scoped + stored)`);
  assert.deepEqual(result.diagnostics, []);
});
