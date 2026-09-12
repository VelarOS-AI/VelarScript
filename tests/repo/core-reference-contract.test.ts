import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CORE_EXPRESSION_CONSTRUCTS, PERMANENT_NAMESPACE_NAMES, compile } from "@velarscript/compiler";
import { coreVocabularyType } from "../../packages/compiler/src/analysis/vocabulary.ts";

test("the documented permanent namespace roster matches the compiler's available members", async () => {
  const charter = await readFile(new URL("../../docs/language-charter.md", import.meta.url), "utf8");
  for (const name of PERMANENT_NAMESPACE_NAMES) {
    const row = charter.split("\n").find(line => line.startsWith(`| \`${name}.\` |`));
    assert.ok(row, `the reference must enumerate ${name}`);
    const documented = [...row.split("|")[3]!.matchAll(/`([^`]+)`/gu)].map(match => match[1]!).sort();
    const type = coreVocabularyType(name);
    assert.equal(type?.kind, "object");
    if (type?.kind !== "object") return;
    assert.deepEqual(documented, [...type.fields.keys()].sort(), `${name} must not teach unavailable or omit available members`);
  }
});

test("the conditional construct's advertised spelling is accepted source syntax", () => {
  const expression = CORE_EXPRESSION_CONSTRUCTS.ConditionalExpression
    .replaceAll("condition", "true").replaceAll("value", "1").replaceAll("fallback", "2");
  assert.deepEqual(compile(`const selected = ${expression}\n`).diagnostics, []);
});
