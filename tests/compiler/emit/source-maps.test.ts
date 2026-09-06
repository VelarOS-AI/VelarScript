import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { SourceMap } from "node:module";
import { compile as compileCore, formatDiagnostic, SourceText } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { compile } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("CLI source maps lead runtime stacks back to .vel source", async () => {
  const directory = await makeTemporaryDirectory("velar-source-map-");
  const sourcePath = join(directory, "main.vel");
  const outputPath = join(directory, "main.js");
  await writeFile(sourcePath, "const values = [1]\nprint(values[4])\n", "utf8");
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", sourcePath, "--out", outputPath, "--source-maps"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);

  const execution = spawnSync(process.execPath, ["--enable-source-maps", outputPath], { encoding: "utf8" });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, new RegExp(`${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:2:`));
});

test("编译入口关闭 Source Map 时也跳过嵌入 JavaScript 的映射生成", () => {
  const result = compileCore(`
unsafe js\`
export const ready = 1;
\`
`.trimStart(), { path: "unmapped.vel", emitSourceMap: false });
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.code);
  assert.equal(result.sourceMap, null);
  assert.equal(result.embeddedModules.length, 1);
  assert.equal(result.embeddedModules[0]!.sourceMap, "");
});

test("Windows source paths become valid source-map file URLs and portable diagnostics", () => {
  const sourcePath = "C:\\Users\\author\\project\\main.vel";
  const result = compileCore("const answer = 42\n", { path: sourcePath });
  const map = JSON.parse(result.sourceMap ?? "{}") as { sources?: readonly string[] };
  assert.deepEqual(map.sources, ["file:///C:/Users/author/project/main.vel"]);
  const invalid = compileCore('const answer: number = "wrong"\n', { path: sourcePath });
  assert.match(formatDiagnostic(invalid.source, invalid.diagnostics[0]!), /^C:\/Users\/author\/project\/main\.vel:1:/u);
});

test("source maps retain nested statement and expression columns", () => {
  const result = compileCore(`
def choose(value: number) -> number:
    if value > 2:
        return value * 2
    return value + 1
`.trimStart(), { path: "mapped.vel" });
  assert.deepEqual(result.diagnostics, []);
  const map = JSON.parse(result.sourceMap ?? "{}") as { mappings?: string };
  const generatedIf = map.mappings?.split(";")[1] ?? "";
  assert.ok(generatedIf.split(",").filter(Boolean).length >= 4, generatedIf);
});

test("source maps preserve exact positions when generated child text is repeated and reordered", () => {
  const source = `
def echo(value: string) -> string:
    return value

const value = "same"
const result = echo(value=value)
`.trimStart();
  const result = compileCore(source, { path: "named-arguments.vel" });
  assert.deepEqual(result.diagnostics, []);
  const generatedLines = (result.code ?? "").split("\n");
  const generatedLine = generatedLines.findIndex((line) => line.includes("const result"));
  const generated = generatedLines[generatedLine] ?? "";
  const sourceLines = source.split("\n");
  const sourceLine = sourceLines.findIndex((line) => line.includes("const result"));
  const original = sourceLines[sourceLine] ?? "";
  const sourceMap = new SourceMap(JSON.parse(result.sourceMap ?? "{}"));

  const callee = sourceMap.findEntry(generatedLine, generated.indexOf("echo(")) as { originalLine: number; originalColumn: number };
  assert.equal(callee.originalLine, sourceLine);
  assert.equal(callee.originalColumn, original.indexOf("echo("));

  const argument = sourceMap.findEntry(generatedLine, generated.lastIndexOf("value")) as { originalLine: number; originalColumn: number };
  assert.equal(argument.originalLine, sourceLine);
  assert.equal(argument.originalColumn, original.lastIndexOf("value"));
});

test("Web source maps retain nested JSX elements, attributes, text, and expressions", () => {
  const source = `
component Child(label: string):
    return <span>{label}</span>

component App:
    const title = "ready"
    return <main><section aria-label="panel"><Child label={title} /><p>{title}</p><strong>Static</strong></section></main>
`.trimStart();
  const result = compile(source, { path: "jsx-map.vel" });
  assert.deepEqual(result.diagnostics, []);
  const generatedLines = (result.code ?? "").split("\n");
  const generatedLine = generatedLines.findIndex((line) => line.includes('__velarCreateElement("section"'));
  const generated = generatedLines[generatedLine] ?? "";
  const sourceMap = new SourceMap(JSON.parse(result.sourceMap ?? "{}"));
  const sourceText = new SourceText("jsx-map.vel", source);
  const assertMapped = (generatedNeedle: string, sourceOffset: number): void => {
    const generatedColumn = generated.indexOf(generatedNeedle);
    assert.ok(generatedColumn >= 0, generatedNeedle);
    const entry = sourceMap.findEntry(generatedLine, generatedColumn) as { originalLine: number; originalColumn: number };
    const expected = sourceText.location(sourceOffset);
    assert.equal(entry.originalLine, expected.line - 1, generatedNeedle);
    assert.equal(entry.originalColumn, expected.column - 1, generatedNeedle);
  };

  assertMapped('__velarCreateElement("main"', source.indexOf("<main"));
  assertMapped('__velarCreateElement("section"', source.indexOf("<section"));
  assertMapped("__velarStaticAttr(__velarElement", source.indexOf("aria-label"));
  assertMapped("__velarChild(Child,", source.indexOf("<Child"));
  assertMapped("label:", source.indexOf("label={"));
  assertMapped('__velarCreateElement("p"', source.indexOf("<p>"));
  assertMapped("=> title", source.lastIndexOf("title"));
  assertMapped('__velarCreateElement("strong"', source.indexOf("<strong>"));
  assertMapped('__velarDomCreateTextNode("Static")', source.indexOf("Static"));
});
