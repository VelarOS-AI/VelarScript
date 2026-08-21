import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { describeType } from "@velarscript/compiler";
import { loadTypeScriptDeclarations, parseTypeScriptDeclarations } from "../packages/cli/src/typescript-declarations.ts";

function describeExport(source: string, name: string): string {
  const bridge = parseTypeScriptDeclarations(source);
  const type = bridge.exports.get(name);
  assert.ok(type, `expected the declaration bridge to export '${name}', got [${[...bridge.exports.keys()].join(", ")}]`);
  return describeType(type);
}

test("[cli-x10] a string literal type carrying comment punctuation keeps every neighbouring declaration", () => {
  const bridge = parseTypeScriptDeclarations([
    `export declare const openPattern: "/*";`,
    "export declare function importantFunction(a: string): string;",
    "export interface Config { retries: number }",
    `export declare const closePattern: "*/";`,
    "export declare function other(): number;",
    "",
  ].join("\n"));
  assert.deepEqual(
    [...bridge.exports.keys()].sort(),
    ["closePattern", "importantFunction", "openPattern", "other"],
  );
  assert.equal(describeType(bridge.exports.get("importantFunction")!), "(string) -> string");
  assert.ok(bridge.typeExports.has("Config"));
  assert.deepEqual(bridge.warnings, []);
});

test("[cli-x10] a URL string literal type does not strip the rest of its line", () => {
  const bridge = parseTypeScriptDeclarations([
    `export declare const home: "http://example.com";`,
    "export declare function alsoExported(): number;",
    "",
  ].join("\n"));
  assert.deepEqual([...bridge.exports.keys()].sort(), ["alsoExported", "home"]);
  assert.equal(describeType(bridge.exports.get("alsoExported")!), "() -> number");
});

test("[cli-x10] a real comment is still removed and its bytes keep every later offset", () => {
  const bridge = parseTypeScriptDeclarations([
    "/** documentation for the export below */",
    "export declare function documented(a: string): string; // trailing note",
    "/* a block comment holding export declare function ghost(): number; */",
    "",
  ].join("\n"));
  assert.deepEqual([...bridge.exports.keys()], ["documented"]);
  assert.equal(describeType(bridge.exports.get("documented")!), "(string) -> string");
});

test("[cli-x3] an ambient block does not fabricate a module export the package does not have", () => {
  for (const [label, block] of [
    ["declare global", "declare global {\n  export function polyfilled(): string;\n}"],
    ["declare namespace Helpers", "declare namespace Helpers {\n  export const polyfilled: string;\n}"],
    [`declare module "other-pkg"`, `declare module "other-pkg" {\n  export declare class polyfilled { id: string }\n}`],
  ] as const) {
    const bridge = parseTypeScriptDeclarations(`${block}\nexport declare function real(): number;\n`);
    assert.deepEqual([...bridge.exports.keys()], ["real"], label);
    assert.ok(!bridge.typeExports.has("polyfilled"), label);
    assert.ok(
      bridge.warnings.some((warning) => warning.includes(`Ambient '${label}' block`)),
      `${label}: expected an excision notice, got [${bridge.warnings.join(" | ")}]`,
    );
  }
});

test("[cli-x3] a nested ambient block is reported once and a string literal cannot fake one", () => {
  const nested = parseTypeScriptDeclarations([
    "declare global {",
    "  namespace NodeJS {",
    "    export const inner: string;",
    "  }",
    "}",
    "export declare function real(): number;",
    "",
  ].join("\n"));
  assert.deepEqual([...nested.exports.keys()], ["real"]);
  assert.equal(nested.warnings.length, 1);
  const literal = parseTypeScriptDeclarations([
    `export declare const snippet: "declare global {";`,
    "export declare function real(): number;",
    "",
  ].join("\n"));
  assert.deepEqual([...literal.exports.keys()].sort(), ["real", "snippet"]);
  assert.deepEqual(literal.warnings, []);
});

test("[cli-x3] a package's own ambient module keeps its contract", () => {
  const source = [
    `declare module "self-pkg" {`,
    "  export function own(a: string): number;",
    "  export declare const flag: boolean;",
    "}",
    `declare module "other-pkg" {`,
    "  export function borrowed(): string;",
    "}",
    "",
  ].join("\n");
  const own = parseTypeScriptDeclarations(source, "<types>", "<types>", false, new Map(), new Map(), new Set(["self-pkg"]));
  assert.deepEqual([...own.exports.keys()].sort(), ["flag", "own"]);
  assert.equal(describeType(own.exports.get("own")!), "(string) -> number");
  assert.equal(own.warnings.length, 1);
  assert.ok(own.warnings[0]!.includes(`declare module "other-pkg"`));
  const foreign = parseTypeScriptDeclarations(source);
  assert.deepEqual([...foreign.exports.keys()], []);
  assert.equal(foreign.warnings.length, 2);
});

test("[cli-x3] a foreign block nested in a kept own module is excised on either line", () => {
  // The outer match consumes the own module's opening brace, so a block that
  // opens on the same line has no statement start left in front of it. Both
  // spellings must read the same.
  for (const [label, body] of [
    ["same line", `declare global { export function bad(): void } export function good(): number;`],
    ["own line", `\n  declare global { export function bad(): void }\n  export function good(): number;\n`],
  ] as const) {
    const bridge = parseTypeScriptDeclarations(
      `declare module "self-pkg" { ${body} }\n`,
      "<types>",
      "<types>",
      false,
      new Map(),
      new Map(),
      new Set(["self-pkg"]),
    );
    assert.deepEqual([...bridge.exports.keys()], ["good"], label);
    assert.equal(describeType(bridge.exports.get("good")!), "() -> number", label);
    assert.equal(bridge.warnings.length, 1, `${label}: got [${bridge.warnings.join(" | ")}]`);
    assert.ok(bridge.warnings[0]!.includes("Ambient 'declare global' block"), label);
  }
});

test("[cli-x18] a string literal type carrying the separator keeps parameter arity and union members", () => {
  const bridge = parseTypeScriptDeclarations(`export declare function pick(mode: "a,b" | "c", flag: boolean): string;\n`);
  const picked = bridge.exports.get("pick");
  assert.ok(picked && picked.kind === "function");
  assert.equal(picked.parameters.length, 2);
  assert.equal(picked.requiredParameters, 2);
  assert.equal(describeType(picked.parameters[1]!), "bool");
  assert.ok(
    !bridge.warnings.some((warning) => warning.includes("follows an optional parameter")),
    `no phantom parameter notice expected, got [${bridge.warnings.join(" | ")}]`,
  );
  assert.equal(describeExport(`export type Sep = "a|b" | "c";\nexport declare const sep: Sep;\n`, "sep"), "string");
});

test("[cli-x17] a member without a trailing semicolon does not swallow the member after it", () => {
  assert.equal(
    describeExport("export interface Api { a: string; b(): number\n  c: boolean }\nexport declare function api(): Api;\n", "api"),
    "() -> { a: string, b: () -> number, c: bool }",
  );
  const widget = parseTypeScriptDeclarations("export declare class Widget { id: string; render(): string\n  size: number }\n");
  const constructor = widget.exports.get("Widget");
  assert.ok(constructor && constructor.kind === "classConstructor", `Widget stayed ${describeType(constructor!)}`);
  const info = widget.classes.get("Widget");
  assert.ok(info);
  assert.deepEqual([...info.fields.keys()].sort(), ["id", "size"]);
  assert.deepEqual([...info.methods.keys()], ["render"]);
});

test("[cli-x17] a wrapped type is a continuation, not a new member", () => {
  assert.equal(
    describeExport([
      "export interface Wrapped {",
      "  lookup:",
      "    string;",
      "  choice: string",
      "    | number",
      "  tail: boolean",
      "}",
      "export declare function wrapped(): Wrapped;",
      "",
    ].join("\n"), "wrapped"),
    "() -> { lookup: string, choice: string | number, tail: bool }",
  );
});

test("[cli-x11] a TypeScript this pseudo-parameter is not a positional parameter", () => {
  assert.equal(describeExport("export declare function bind(this: object, x: number): string;\n", "bind"), "(number) -> string");
  assert.equal(
    describeExport("export interface Handler { run(this: Handler, value: number): string }\nexport declare const handler: Handler;\n", "handler"),
    "{ run: (number) -> string }",
  );
  const box = parseTypeScriptDeclarations("export declare class Box { constructor(this: Box, value: number); use(this: Box, n: number): string }\n");
  const info = box.classes.get("Box");
  assert.ok(info);
  assert.equal(info.parameters.length, 1);
  assert.equal(info.requiredParameters, 1);
  assert.equal(describeType(info.methods.get("use")!), "(number) -> string");
  assert.equal(
    describeExport(`export declare const run: (this: object, x: number) => string;\n`, "run"),
    "(number) -> string",
  );
});

test("[cli-x3] a subpath's own ambient module keeps its contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-tsdecl-"));
  try {
    const packageRoot = join(root, "node_modules", "legacypkg");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "legacypkg",
      version: "1.0.0",
      exports: {
        ".": { types: "./index.d.ts", default: "./index.js" },
        "./sub": { types: "./sub.d.ts", default: "./sub.js" },
      },
    }), "utf8");
    await writeFile(join(packageRoot, "index.d.ts"), `declare module "legacypkg" {\n  export function rootThing(a: string): number;\n}\n`, "utf8");
    await writeFile(join(packageRoot, "sub.d.ts"), `declare module "legacypkg/sub" {\n  export function subThing(a: string): number;\n}\n`, "utf8");
    await writeFile(join(packageRoot, "index.js"), "", "utf8");
    await writeFile(join(packageRoot, "sub.js"), "", "utf8");

    const rootBridge = await loadTypeScriptDeclarations("legacypkg", join(root, "main.js"));
    assert.ok(rootBridge);
    assert.equal(describeType(rootBridge.exports.get("rootThing")!), "(string) -> number");
    assert.deepEqual(rootBridge.warnings, []);

    // The subpath declares its own specifier, not the bare package name; it is
    // the module's own contract and must not be excised as a foreign block.
    const subBridge = await loadTypeScriptDeclarations("legacypkg/sub", join(root, "main.js"));
    assert.ok(subBridge);
    assert.equal(describeType(subBridge.exports.get("subThing")!), "(string) -> number");
    assert.deepEqual(subBridge.warnings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
