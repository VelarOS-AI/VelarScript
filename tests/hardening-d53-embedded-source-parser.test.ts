import assert from "node:assert/strict";
import test from "node:test";
import type { EmbeddedJavaScriptDeclaration } from "../packages/compiler/src/ast.ts";
import { scanOpaqueEmbeddedSource } from "../packages/compiler/src/embedded-source.ts";
import type { CompilerExtension } from "../packages/compiler/src/extension.ts";
import { formatSource } from "../packages/compiler/src/formatter.ts";
import { Lexer } from "../packages/compiler/src/lexer.ts";
import { Parser } from "../packages/compiler/src/parser.ts";
import { assertUniqueEmbeddedModuleOutputs } from "../packages/cli/src/embedded-modules.ts";

function parseOnly(source: string): {
  readonly declarations: readonly EmbeddedJavaScriptDeclaration[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly span: { readonly start: number; readonly end: number } }[];
} {
  const lexed = new Lexer(source).lex();
  const parsed = new Parser(lexed.tokens).parse();
  return {
    declarations: parsed.program.body.filter((statement): statement is EmbeddedJavaScriptDeclaration => statement.kind === "EmbeddedJavaScriptDeclaration"),
    diagnostics: [...lexed.diagnostics, ...parsed.diagnostics],
  };
}

function applyFactoryEdits(source: string, declaration: EmbeddedJavaScriptDeclaration): string {
  let body = declaration.source;
  for (const edit of [...declaration.factoryEdits].sort((left, right) => right.span.start - left.span.start)) {
    const start = edit.span.start - declaration.sourceSpan.start;
    const end = edit.span.end - declaration.sourceSpan.start;
    body = `${body.slice(0, start)}${edit.replacement}${body.slice(end)}`;
  }
  return body;
}

test("D53 checked JS preserves raw offsets and publishes AST-derived factory metadata", () => {
  const source = [
    "extern js(factor: number, prefix: string)`",
    '    import {join as joinPath} from "node:path"',
    "    const internal = joinPath(prefix, String(factor))",
    "    export function scale(n) { return n * factor }",
    "    const label = (n) => `${prefix}:${n}:${internal}`",
    "    export {label as describe}",
    "`:",
    "    export def scale(n: number) -> number",
    "    export def describe(n: number) -> string",
    "",
  ].join("\n");
  const parsed = parseOnly(source);
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.declarations.length, 1);
  const declaration = parsed.declarations[0]!;
  assert.equal(declaration.unsafe, false);
  assert.deepEqual(declaration.captures.map((capture) => capture.name), ["factor", "prefix"]);
  assert.equal(source.slice(declaration.captures[0]!.nameSpan.start, declaration.captures[0]!.nameSpan.end), "factor");
  assert.equal(source.slice(declaration.sourceSpan.start, declaration.sourceSpan.end), declaration.source);
  assert.equal(declaration.source[0], " ");
  assert.equal(declaration.source.at(-1), "\n");
  assert.match(declaration.source, /`\$\{prefix\}:\$\{n\}:\$\{internal\}`/u);
  assert.deepEqual(
    declaration.exports.map((item) => ({ name: item.name, local: item.local })),
    [{ name: "scale", local: "scale" }, { name: "describe", local: "label" }],
  );
  assert.deepEqual(declaration.bindings.map((item) => item.name), ["joinPath", "internal", "scale", "label"]);
  assert.equal(declaration.imports.length, 1);
  assert.equal(source.slice(declaration.imports[0]!.span.start, declaration.imports[0]!.span.end), 'import {join as joinPath} from "node:path"');
  const factoryBody = applyFactoryEdits(source, declaration);
  assert.doesNotMatch(factoryBody, /import \{/u);
  assert.doesNotMatch(factoryBody, /export /u);
  assert.match(factoryBody, /function scale\(n\)/u);
  assert.match(factoryBody, /const label = \(n\) => `\$\{prefix\}:\$\{n\}:\$\{internal\}`/u);
  assert.ok(declaration.contract);
  assert.deepEqual(declaration.contract.functions.map((item) => item.name), ["scale", "describe"]);
});

test("D53 unsafe JS keeps braces, dollar braces, backslashes, and JavaScript template literals opaque", () => {
  const source = [
    "unsafe js`",
    "    const braces = String.raw`\\n ${literal} {kept}`",
    "`standalone ${literal}`",
    '    const slash = "\\\\n"',
    "    export {braces, slash}",
    "`",
    "",
  ].join("\n");
  const parsed = parseOnly(source);
  assert.deepEqual(parsed.diagnostics, []);
  const declaration = parsed.declarations[0]!;
  assert.equal(declaration.unsafe, true);
  assert.equal(declaration.contract, null);
  assert.equal(source.slice(declaration.sourceSpan.start, declaration.sourceSpan.end), declaration.source);
  assert.match(declaration.source, /String\.raw`\\n \$\{literal\} \{kept\}`/u);
  assert.match(declaration.source, /^`standalone \$\{literal\}`$/mu);
  assert.match(declaration.source, /"\\\\n"/u);
  assert.deepEqual(declaration.exports.map((item) => item.name), ["braces", "slash"]);
});

test("D53 leaves ordinary inline and invalid multiline backtick strings on their old path", () => {
  const inline = parseOnly("const text = `literal ${stillText} {braces} \\\\n`\n");
  assert.deepEqual(inline.diagnostics, []);
  assert.deepEqual(inline.declarations, []);

  const multiline = new Lexer("const text = `first\nsecond`\n").lex();
  assert.ok(multiline.diagnostics.some((item) => item.code === "VEL1003" && item.message.startsWith("Inline strings cannot contain a line break")));
});

test("D53 formatter treats the whole foreign source payload as opaque", () => {
  const source = [
    "extern   js( factor:number,prefix :string)`",
    "    export   function scale( n ) {return `${prefix}:${n * factor}`}",
    "`:",
    "  export def scale(n:number)->number",
    "",
  ].join("\n");
  const before = parseOnly(source).declarations[0]!;
  const formatted = formatSource(source);
  const after = parseOnly(formatted);
  assert.deepEqual(after.diagnostics, []);
  assert.equal(after.declarations[0]!.source, before.source, "the JavaScript bytes are not formatted as VelarScript");
  assert.match(formatted, /^extern js\(factor: number, prefix: string\)`/u);
});

test("D53 formatter lets an extension preserve its own opaque source without teaching Core its language", () => {
  const extension: CompilerExtension = {
    id: "test:opaque-formatting-owner",
    formatting: {
      scanOpaqueSource(source, start) {
        if (source[start] !== "`") return null;
        const lineStart = Math.max(source.lastIndexOf("\n", start - 1), source.lastIndexOf("\r", start - 1)) + 1;
        const header = source.slice(lineStart, start);
        if (header.trim() !== "foreign raw") return null;
        const indentation = /^[ \t]*/u.exec(header)?.[0] ?? "";
        const scanned = scanOpaqueEmbeddedSource(source, start, indentation, (tail) => tail.trim() === "before view");
        return { end: scanned.end, attachedToPrevious: true };
      },
    },
  };
  const source = [
    "foreign raw`",
    "  keep   every ${byte} \\\\ literal",
    "` before view",
    "",
  ].join("\n");
  const formatted = formatSource(source, { extensions: [extension] });
  assert.equal(formatted, source);
});

test("D53 maps JavaScript and lowering refusals to their original source spans", () => {
  const source = [
    "extern js(...factor: number = 1)`",
    "    import {value as factor} from \"pkg\"",
    "    export default factor",
    "    export * from \"other\"",
    "    await Promise.resolve()",
    "`:",
    "    export const factor: number",
    "",
    "unsafe js`",
    "    export function broken(@) {}",
    "`",
    "",
  ].join("\n");
  const parsed = parseOnly(source);
  const messages = parsed.diagnostics.map((item) => item.message);
  assert.ok(messages.some((message) => message.includes("rest captures are not supported")), messages.join("\n"));
  assert.ok(messages.some((message) => message.includes("cannot declare defaults")), messages.join("\n"));
  assert.ok(messages.some((message) => message.includes("conflicts with a top-level JavaScript binding")), messages.join("\n"));
  assert.ok(messages.some((message) => message.includes("cannot use a default export")), messages.join("\n"));
  assert.ok(messages.some((message) => message.includes("cannot use bare 'export *'")), messages.join("\n"));
  assert.ok(messages.some((message) => message.includes("cannot use top-level await")), messages.join("\n"));
  const syntax = parsed.diagnostics.find((item) => item.message.startsWith("JavaScript syntax error:"));
  assert.ok(syntax);
  assert.equal(source.slice(syntax.span.start, syntax.span.end), "@");
});

test("D53 refuses capture/export alias shadowing and relative embedded module edges", () => {
  const source = [
    "extern js(factor: number)`",
    "    const local = 1",
    "    export {local as factor}",
    "`:",
    "    export const factor: number",
    "",
    "unsafe js`",
    "    import value from \"./helper.js\"",
    "    export {other} from \"../other.js\"",
    "    export async function load() { return import(`./dynamic.js`) }",
    "`",
    "",
  ].join("\n");
  const parsed = parseOnly(source);
  const messages = parsed.diagnostics.map((item) => item.message);
  assert.ok(messages.some((message) => message.includes("Capture 'factor' conflicts with a JavaScript export")), messages.join("\n"));
  assert.equal(messages.filter((message) => message.includes("Relative JavaScript import target")).length, 3, messages.join("\n"));
});

test("D53 rejects an owner/sibling output collision before either artifact is written", () => {
  assert.throws(() => assertUniqueEmbeddedModuleOutputs([
    { ownerPath: "/tmp/app.js", embeddedModules: [{ specifier: "./app.embedded.js", code: "", sourceMap: "" }] },
    { ownerPath: "/tmp/app.embedded.js", embeddedModules: [] },
  ]), /Embedded JavaScript output collision/u);
});

test("D53 rejects non-name exports without guessing through JavaScript text", () => {
  const source = [
    "unsafe js`",
    "    const value = 1",
    "    export {value as default}",
    "    export {value as \"not-a-vel-name\"}",
    "`",
    "",
  ].join("\n");
  const parsed = parseOnly(source);
  assert.ok(parsed.diagnostics.some((item) => item.message.includes("cannot export 'default'")), parsed.diagnostics.map((item) => item.message).join("\n"));
  assert.ok(parsed.diagnostics.some((item) => item.message.includes("cannot enter VelarScript scope")), parsed.diagnostics.map((item) => item.message).join("\n"));
});

test("D53 checks that a checked contract and the JavaScript named exports are the same set", () => {
  const source = [
    "extern js()`",
    "    export function present() {}",
    "    export const extra = 1",
    "`:",
    "    export def present()",
    "    export def missing()",
    "",
  ].join("\n");
  const parsed = parseOnly(source);
  assert.ok(parsed.diagnostics.some((item) => item.message.includes("contract declares 'missing'")), parsed.diagnostics.map((item) => item.message).join("\n"));
  assert.ok(parsed.diagnostics.some((item) => item.message.includes("export 'extra' has no checked contract")), parsed.diagnostics.map((item) => item.message).join("\n"));
});

test("D53 offers the data-URL rewrite only when its named bindings exactly equal all exports", () => {
  const source = 'import js unsafe {hash} from "data:text/javascript,export%20function%20hash(value)%7Breturn%20value%7D"\n';
  const lexed = new Lexer(source).lex();
  const parsed = new Parser(lexed.tokens).parse();
  const migration = parsed.diagnostics.find((item) => item.message.includes("source-mapped block spelling"));
  assert.ok(migration?.fix);
  const edit = migration.fix.edits[0]!;
  const rewritten = `${source.slice(0, edit.span.start)}${edit.text}${source.slice(edit.span.end)}`;
  assert.match(rewritten, /^unsafe js`\nexport function hash\(value\)\{return value\}\n`/u);
  assert.deepEqual(parseOnly(rewritten).diagnostics, []);

  const aliased = parseOnly('import js unsafe {hash as renamed} from "data:text/javascript,export%20function%20hash()%7B%7D"\n');
  assert.ok(!aliased.diagnostics.some((item) => item.message.includes("source-mapped block spelling")));
  const partial = parseOnly('import js unsafe {hash} from "data:text/javascript,export%20function%20hash()%7B%7D%20export%20const%20other%3D1"\n');
  assert.ok(!partial.diagnostics.some((item) => item.message.includes("source-mapped block spelling")));
});
