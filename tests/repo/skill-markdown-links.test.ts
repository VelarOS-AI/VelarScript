import assert from "node:assert/strict";
import test from "node:test";
import { checkSkillMarkdownLinks, markdownAnchors, markdownLinks } from "../../scripts/skill-markdown-links.mjs";

test("offline link scanning keeps code examples out of the document link graph", () => {
  const markdown = [
    "[`types.md`](types.md#readonly)",
    "`[example](not-a-reference.md)`",
    "```velar",
    'const text = "[example](also-not-a-reference.md)"',
    "```",
    "[contract](<contract.md#c7--验证错误使用共同的结构化路径>)",
    "[named]: types.md#readonly",
    "",
  ].join("\n");
  const links = markdownLinks(markdown);
  assert.deepEqual(links.map(link => link.target), ["types.md#readonly", "contract.md#c7--验证错误使用共同的结构化路径", "types.md#readonly"]);
  for (const link of links) assert.equal(markdown.slice(link.start, link.end), link.target);
});

test("offline anchors include Unicode and duplicate headings but exclude fenced headings", () => {
  assert.deepEqual([...markdownAnchors([
    "### C7 — 验证错误使用共同的结构化路径",
    "## `readonly`",
    "## `readonly`",
    "## Generic `Box<T>`",
    "```text",
    "## absent",
    "```",
  ].join("\n"))], ["c7--验证错误使用共同的结构化路径", "readonly", "readonly-1", "generic-boxt"]);
});

test("offline link verification rejects missing files and headings inside the packaged graph", () => {
  const files = new Map([
    ["reference/index.md", "[type](types.md#readonly) [duplicate](types.md#readonly-1) [web](https://example.com)\n"],
    ["reference/types.md", "# Types\n## readonly\n## readonly\n[self](#types)\n"],
  ]);
  assert.deepEqual(checkSkillMarkdownLinks(files), []);
  files.set("reference/index.md", "[missing](missing.md) [heading](types.md#absent) [outside](../../docs/charter.md) [absolute](/types.md)\n");
  const failures = checkSkillMarkdownLinks(files);
  assert.equal(failures.length, 4);
  assert.match(failures[0]!, /no packaged target/u);
  assert.match(failures[1]!, /no packaged heading/u);
  assert.match(failures[2]!, /no packaged target/u);
  assert.match(failures[3]!, /package-relative path/u);
});
