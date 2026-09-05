import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectJavaScriptModule,
  MAX_JAVASCRIPT_MODULE_SYNTAX_NODES,
  MAX_JAVASCRIPT_MODULE_TOKENS,
} from "@velarscript/compiler";

test("the compiler enumerates every statically declared and dynamic ECMAScript module edge", () => {
  const source = [
    "#!/usr/bin/env node",
    'import value from "external-package";',
    'export { value as renamed } from "./named.js";',
    'export * from "../all.js";',
    'void import("./literal.js");',
    "void import(`./template.js`);",
    'const part = "computed";',
    "void import(`./${part}.js`);",
    "void import.meta.url;",
    "",
  ].join("\n");
  const inspection = inspectJavaScriptModule(source);

  assert.deepEqual(
    inspection.edges.map((edge) => ({ source: edge.source, dynamic: edge.dynamic })),
    [
      { source: "external-package", dynamic: false },
      { source: "./named.js", dynamic: false },
      { source: "../all.js", dynamic: false },
      { source: "./literal.js", dynamic: true },
      { source: "./template.js", dynamic: true },
      { source: null, dynamic: true },
    ],
  );
  assert.deepEqual(
    inspection.edges.map((edge) => source.slice(edge.start, edge.end)),
    ['"external-package"', '"./named.js"', '"../all.js"', '"./literal.js"', "`./template.js`", "`./${part}.js`"],
  );
  assert.ok(inspection.syntaxNodes > inspection.edges.length);
});

test("the compiler rejects invalid modules and closes its syntax-tree budget", () => {
  assert.throws(() => inspectJavaScriptModule("export const = 1;"), SyntaxError);
  assert.throws(
    () => inspectJavaScriptModule("value", { maximumSyntaxNodes: 2 }),
    /JavaScript module syntax tree exceeds 2 nodes/u,
  );
  for (const maximumSyntaxNodes of [0, MAX_JAVASCRIPT_MODULE_SYNTAX_NODES + 1, 1.5]) {
    assert.throws(
      () => inspectJavaScriptModule("", { maximumSyntaxNodes }),
      /maximumSyntaxNodes must be an integer/u,
    );
  }
  assert.throws(
    () => inspectJavaScriptModule("first; second;", { maximumTokens: 1 }),
    /JavaScript module token stream exceeds 1 tokens/u,
  );
  for (const maximumTokens of [0, MAX_JAVASCRIPT_MODULE_TOKENS + 1, 1.5]) {
    assert.throws(
      () => inspectJavaScriptModule("", { maximumTokens }),
      /maximumTokens must be an integer/u,
    );
  }
});
