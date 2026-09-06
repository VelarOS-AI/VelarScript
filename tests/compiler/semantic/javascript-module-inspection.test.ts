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
    'export { value as renamed } from "./na\\u006ded.js";',
    'export * from "../all.js";',
    'void import("./literal.js");',
    "void import(`./template.js`);",
    'const part = "computed";',
    "void import(`./${part}.js`);",
    "void import.meta.url;",
    'const bundled = require("static-package");',
    "const computedRequired = require(part);",
    'const resolved = require.resolve("resolved-package");',
    'const required = (0, globalThis["require"])("hidden-package");',
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
    ['"external-package"', '"./na\\u006ded.js"', '"../all.js"', '"./literal.js"', "`./template.js`", "`./${part}.js`"],
  );
  assert.deepEqual(
    inspection.opaqueLoads.map((load) => ({
      kind: load.kind,
      target: load.target,
      bundlerVisible: load.bundlerVisible,
      source: source.slice(load.start, load.end),
    })),
    [
      { kind: "commonjs-require", target: "static-package", bundlerVisible: true, source: "require" },
      { kind: "commonjs-require", target: null, bundlerVisible: true, source: "require" },
      { kind: "commonjs-require", target: "resolved-package", bundlerVisible: false, source: "require.resolve" },
      { kind: "commonjs-require", target: "hidden-package", bundlerVisible: false, source: 'globalThis["require"]' },
    ],
  );
  assert.ok(inspection.syntaxNodes > inspection.edges.length);
  assert.ok(inspection.tokens > inspection.edges.length);
});

test("the compiler follows only proven Node loader bindings and global aliases", () => {
  const source = [
    'import moduleDefault, { createRequire as factory } from "module";',
    'import * as nodeModule from "node:module";',
    "const { createRequire: destructuredFactory } = nodeModule;",
    "const memberFactory = moduleDefault.createRequire;",
    "const { require: globalLoad, module: { require: nestedGlobalLoad } } = globalThis;",
    "const directGlobalLoad = globalThis.require;",
    "factory(import.meta.url);",
    "nodeModule.createRequire(import.meta.url);",
    "moduleDefault.createRequire(import.meta.url);",
    "destructuredFactory(import.meta.url);",
    "memberFactory(import.meta.url);",
    'globalThis.require("global-direct");',
    "globalThis.module.require(`global-module`);",
    'globalLoad("global-alias");',
    'nestedGlobalLoad("nested-alias");',
    'directGlobalLoad("member-alias");',
    'directGlobalLoad.resolve("member-resolved");',
    "const returnedLoad = factory(import.meta.url);",
    'returnedLoad("returned-loader");',
    "",
  ].join("\n");

  assert.deepEqual(
    inspectJavaScriptModule(source).opaqueLoads.map((load) => ({
      kind: load.kind,
      target: load.target,
      bundlerVisible: load.bundlerVisible,
      source: source.slice(load.start, load.end),
    })),
    [
      { kind: "create-require", target: null, bundlerVisible: false, source: "factory" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "nodeModule.createRequire" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "moduleDefault.createRequire" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "destructuredFactory" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "memberFactory" },
      { kind: "commonjs-require", target: "global-direct", bundlerVisible: false, source: "globalThis.require" },
      { kind: "commonjs-require", target: "global-module", bundlerVisible: false, source: "globalThis.module.require" },
      { kind: "commonjs-require", target: "global-alias", bundlerVisible: false, source: "globalLoad" },
      { kind: "commonjs-require", target: "nested-alias", bundlerVisible: false, source: "nestedGlobalLoad" },
      { kind: "commonjs-require", target: "member-alias", bundlerVisible: false, source: "directGlobalLoad" },
      { kind: "commonjs-require", target: "member-resolved", bundlerVisible: false, source: "directGlobalLoad.resolve" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "factory" },
      { kind: "commonjs-require", target: "returned-loader", bundlerVisible: false, source: "returnedLoad" },
    ],
  );
});

test("the compiler does not confuse local functions, shadows, or ordinary object members with loaders", () => {
  const source = [
    'import { createRequire as importedFactory } from "node:module";',
    "function createRequire() {}",
    "createRequire(\"local-factory\");",
    "function localRequire() {",
    "  function require() {}",
    '  require("local");',
    '  require.resolve("local-resolve");',
    "  const object = { require() {}, createRequire() {} };",
    '  object.require("member");',
    "  object.createRequire(import.meta.url);",
    "}",
    "function shadowImported(importedFactory) { importedFactory(import.meta.url); }",
    "function shadowGlobals(globalThis, global, module) {",
    '  globalThis.require("local");',
    '  global.require("local");',
    '  module.require("local");',
    "}",
    "importedFactory(import.meta.url);",
    'function actualCommonJs() { return require("external"); }',
    "",
  ].join("\n");

  assert.deepEqual(
    inspectJavaScriptModule(source).opaqueLoads.map((load) => ({
      kind: load.kind,
      target: load.target,
      bundlerVisible: load.bundlerVisible,
      source: source.slice(load.start, load.end),
    })),
    [
      { kind: "create-require", target: null, bundlerVisible: false, source: "importedFactory" },
      { kind: "commonjs-require", target: "external", bundlerVisible: true, source: "require" },
    ],
  );
});

test("the compiler follows createRequire obtained through CommonJS and dynamic module namespaces", () => {
  const source = [
    'const { createRequire: fromRequire } = require("node:module");',
    'const moduleNamespace = require("module");',
    "const namespaceAlias = moduleNamespace;",
    "const loadOne = fromRequire(__filename);",
    "const loadTwo = namespaceAlias.createRequire(__filename);",
    'loadOne("hidden-one");',
    "loadTwo(dynamicTarget);",
    'const importedNamespace = await import("node:module");',
    "const { createRequire: fromImport } = importedNamespace;",
    "const loadThree = fromImport(import.meta.url);",
    'loadThree("hidden-three");',
    "let assignedFactory;",
    '({ createRequire: assignedFactory } = require("module"));',
    "const loadFour = assignedFactory(__filename);",
    'loadFour("hidden-four");',
    "const holder = {};",
    'holder.factory = (await import("module")).createRequire;',
    "",
  ].join("\n");

  assert.deepEqual(
    inspectJavaScriptModule(source).opaqueLoads.map((load) => ({
      kind: load.kind,
      target: load.target,
      bundlerVisible: load.bundlerVisible,
      source: source.slice(load.start, load.end),
    })),
    [
      { kind: "commonjs-require", target: "node:module", bundlerVisible: true, source: "require" },
      { kind: "commonjs-require", target: "module", bundlerVisible: true, source: "require" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "fromRequire" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "namespaceAlias.createRequire" },
      { kind: "commonjs-require", target: "hidden-one", bundlerVisible: false, source: "loadOne" },
      { kind: "commonjs-require", target: null, bundlerVisible: false, source: "loadTwo" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "fromImport" },
      { kind: "commonjs-require", target: "hidden-three", bundlerVisible: false, source: "loadThree" },
      { kind: "commonjs-require", target: "module", bundlerVisible: true, source: "require" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "assignedFactory" },
      { kind: "commonjs-require", target: "hidden-four", bundlerVisible: false, source: "loadFour" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "holder.factory" },
    ],
  );
});

test("the compiler joins loader aliases across duplicate declarations and expression branches", () => {
  const source = [
    'const moduleNamespace = await import("node:module");',
    "var duplicateFactory;",
    "var duplicateFactory = moduleNamespace.createRequire;",
    "const duplicateLoad = duplicateFactory(import.meta.url);",
    'duplicateLoad("duplicate-hidden");',
    "const conditionalFactory = flag ? moduleNamespace.createRequire : null;",
    "const conditionalLoad = conditionalFactory(import.meta.url);",
    'conditionalLoad("conditional-hidden");',
    "const logicalFactory = fallback || moduleNamespace.createRequire;",
    "const logicalLoad = logicalFactory(import.meta.url);",
    'logicalLoad("logical-hidden");',
    "",
  ].join("\n");

  assert.deepEqual(
    inspectJavaScriptModule(source).opaqueLoads.map((load) => ({
      kind: load.kind,
      target: load.target,
      bundlerVisible: load.bundlerVisible,
      source: source.slice(load.start, load.end),
    })),
    [
      { kind: "create-require", target: null, bundlerVisible: false, source: "duplicateFactory" },
      { kind: "commonjs-require", target: "duplicate-hidden", bundlerVisible: false, source: "duplicateLoad" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "conditionalFactory" },
      { kind: "commonjs-require", target: "conditional-hidden", bundlerVisible: false, source: "conditionalLoad" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "logicalFactory" },
      { kind: "commonjs-require", target: "logical-hidden", bundlerVisible: false, source: "logicalLoad" },
    ],
  );
});

test("the compiler rejects loader values escaping through defaults, structures, and call arguments", () => {
  const source = [
    "function invoke(defaultLoad = require) {",
    '  return defaultLoad("default-hidden");',
    "}",
    "invoke();",
    "const [structuredLoad] = [globalThis.require];",
    "const pass = (callback) => callback;",
    "pass(require);",
    "",
  ].join("\n");

  assert.deepEqual(
    inspectJavaScriptModule(source).opaqueLoads.map((load) => ({
      kind: load.kind,
      target: load.target,
      bundlerVisible: load.bundlerVisible,
      source: source.slice(load.start, load.end),
    })),
    [
      { kind: "commonjs-require", target: "default-hidden", bundlerVisible: false, source: "defaultLoad" },
      { kind: "commonjs-require", target: null, bundlerVisible: false, source: "globalThis.require" },
      { kind: "commonjs-require", target: null, bundlerVisible: false, source: "require" },
    ],
  );
});

test("the compiler rejects optional, constructed, and namespace-rest loaders", () => {
  const source = [
    'require?.("optional-hidden");',
    'new require("constructed-hidden");',
    'const namespace = await import("node:module");',
    "const { ...namespaceRest } = namespace;",
    "const restLoad = namespaceRest.createRequire(import.meta.url);",
    'restLoad("rest-hidden");',
    "",
  ].join("\n");

  assert.deepEqual(
    inspectJavaScriptModule(source).opaqueLoads.map((load) => ({
      kind: load.kind,
      target: load.target,
      bundlerVisible: load.bundlerVisible,
      source: source.slice(load.start, load.end),
    })),
    [
      { kind: "commonjs-require", target: "optional-hidden", bundlerVisible: false, source: "require" },
      { kind: "commonjs-require", target: "constructed-hidden", bundlerVisible: false, source: "require" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "namespaceRest.createRequire" },
      { kind: "commonjs-require", target: "rest-hidden", bundlerVisible: false, source: "restLoad" },
    ],
  );
});

test("the compiler keeps nested and passed ordinary functions separate from loader origins", () => {
  const source = [
    "function outer(require) {",
    "  function inner(load = require) { return load(\"local\"); }",
    "  const container = [require, { require }];",
    "  const pass = (callback) => callback();",
    "  pass(require);",
    "  return [inner(), container];",
    "}",
    "const ordinaryRequire = () => 1;",
    "const callbacks = { load: ordinaryRequire };",
    "void callbacks;",
    "const inspectObject = (value) => value;",
    "inspectObject(globalThis);",
    "function localSyntax(require, namespace) {",
    '  require?.("local-optional");',
    '  new require("local-construction");',
    "  const { ...rest } = namespace;",
    "  rest.createRequire(import.meta.url);",
    "}",
    "void localSyntax;",
    "",
  ].join("\n");

  assert.deepEqual(inspectJavaScriptModule(source).opaqueLoads, []);
});

test("the compiler treats unknown computed members of unshadowed loader carriers as may-loaders", () => {
  const source = [
    'const globalKey = "require";',
    'globalThis[globalKey]("global-hidden");',
    'const moduleKey = "require";',
    'module[moduleKey]("module-hidden");',
    'import * as nodeModule from "node:module";',
    'const factoryKey = "createRequire";',
    "const computedLoad = nodeModule[factoryKey](import.meta.url);",
    'computedLoad("namespace-hidden");',
    "",
  ].join("\n");

  assert.deepEqual(
    inspectJavaScriptModule(source).opaqueLoads.map((load) => ({
      kind: load.kind,
      target: load.target,
      bundlerVisible: load.bundlerVisible,
      source: source.slice(load.start, load.end),
    })),
    [
      { kind: "commonjs-require", target: "global-hidden", bundlerVisible: false, source: "globalThis[globalKey]" },
      { kind: "commonjs-require", target: "module-hidden", bundlerVisible: false, source: "module[moduleKey]" },
      { kind: "create-require", target: null, bundlerVisible: false, source: "nodeModule[factoryKey]" },
      { kind: "commonjs-require", target: "namespace-hidden", bundlerVisible: false, source: "computedLoad" },
    ],
  );
});

test("the compiler resolves constant safe members and ignores computed members on ordinary or shadowed objects", () => {
  const source = [
    "globalThis[\"setTimeout\"](() => {}, 0);",
    "globalThis[`clearTimeout`](0);",
    "const ordinary = { load() {} };",
    'const key = "load";',
    "ordinary[key]();",
    "function shadow(globalThis, module, nodeModule) {",
    "  globalThis[key]();",
    "  module[key]();",
    "  nodeModule[key]();",
    "}",
    "void shadow;",
    "",
  ].join("\n");

  assert.deepEqual(inspectJavaScriptModule(source).opaqueLoads, []);
});

test("the compiler follows Node getBuiltinModule carriers without confusing local process objects", () => {
  const source = [
    'process.getBuiltinModule("node:path");',
    'process?.["getBuiltinModule"]?.("node:assert");',
    "const { getBuiltinModule: loadBuiltin } = globalThis.process;",
    'loadBuiltin("node:module");',
    "let assignedBuiltin;",
    "assignedBuiltin = process.getBuiltinModule;",
    'assignedBuiltin("node:fs");',
    'process.getBuiltinModule("node:module").createRequire(import.meta.url)("hidden-package");',
    "const pass = (value) => value;",
    "pass(process.getBuiltinModule);",
    "function shadow(process, globalThis) {",
    '  process.getBuiltinModule("local");',
    '  globalThis.process.getBuiltinModule("local");',
    "}",
    "const ordinary = { getBuiltinModule() {} };",
    'ordinary.getBuiltinModule("local");',
    "void shadow;",
    "",
  ].join("\n");

  assert.deepEqual(
    inspectJavaScriptModule(source).opaqueLoads.map((load) => ({
      kind: load.kind,
      target: load.target,
      bundlerVisible: load.bundlerVisible,
      source: source.slice(load.start, load.end),
    })),
    [
      { kind: "get-builtin-module", target: "node:path", bundlerVisible: false, source: "process.getBuiltinModule" },
      { kind: "get-builtin-module", target: "node:assert", bundlerVisible: false, source: 'process?.["getBuiltinModule"]' },
      { kind: "get-builtin-module", target: "node:module", bundlerVisible: false, source: "loadBuiltin" },
      { kind: "get-builtin-module", target: "node:fs", bundlerVisible: false, source: "assignedBuiltin" },
      { kind: "get-builtin-module", target: "node:module", bundlerVisible: false, source: "process.getBuiltinModule" },
      { kind: "create-require", target: null, bundlerVisible: false, source: 'process.getBuiltinModule("node:module").createRequire' },
      { kind: "commonjs-require", target: "hidden-package", bundlerVisible: false, source: 'process.getBuiltinModule("node:module").createRequire(import.meta.url)' },
      { kind: "get-builtin-module", target: null, bundlerVisible: false, source: "process.getBuiltinModule" },
    ],
  );
});

const reverseAliasSource = [
  ...Array.from({ length: 10_000 }, (_, index) => `const loader${index} = loader${index + 1};`),
  "const loader10000 = globalThis.require;",
  'loader0("reverse-hidden");',
].join("\n");

test("the syntax-node budget stops before loader alias propagation", { timeout: 1_000 }, () => {
  assert.throws(
    () => inspectJavaScriptModule(reverseAliasSource, { maximumSyntaxNodes: 2 }),
    /JavaScript module syntax tree exceeds 2 nodes/u,
  );
});

test("reverse loader aliases propagate with linear work", { timeout: 2_000 }, () => {
  const inspection = inspectJavaScriptModule(reverseAliasSource);
  assert.deepEqual(inspection.opaqueLoads, [{
    kind: "commonjs-require",
    target: "reverse-hidden",
    bundlerVisible: false,
    start: reverseAliasSource.lastIndexOf("loader0"),
    end: reverseAliasSource.lastIndexOf("loader0") + "loader0".length,
  }]);
});

test("branching destructuring cannot expand the loader alias graph beyond the syntax budget", { timeout: 1_000 }, () => {
  const count = 512;
  const pattern = Array.from({ length: count }, (_, index) => `property${index}`).join(",");
  const branches = `${Array.from({ length: count }, (_, index) => `flag${index} ? globalThis : `).join("")}globalThis`;
  assert.throws(
    () => inspectJavaScriptModule(`const {${pattern}} = ${branches};`),
    /JavaScript module loader alias graph exceeds \d+ edges/u,
  );
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
