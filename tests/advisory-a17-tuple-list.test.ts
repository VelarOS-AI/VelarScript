import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "@velarscript/compiler";

/**
 * D114 ⑤ — A17: a heterogeneous List literal written where Python would write
 * `return a, b` and JavaScript `return [a, b]`. Vel accepts it as a
 * `List<string | number>` and the author meets the consequence three lines
 * later, so the advisory names the record spelling at the literal itself.
 */

const declarations = [
  "enum Status:",
  "    a",
  "    b",
  "",
  "enum Kind:",
  "    a",
  "    b",
  "",
  "type Item:",
  "    name: string",
  "    size: number",
  "",
].join("\n");

function advisories(body: string): { readonly code: string; readonly message: string; readonly written: string; readonly fix: unknown }[] {
  const source = `${declarations}${body}`;
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => item.message), [], "the module under test must compile");
  return result.advisories.map((item) => ({
    code: item.code,
    message: item.message,
    written: source.slice(item.span.start, item.span.end),
    fix: item.fix,
  }));
}

const codes = (body: string): string[] => advisories(body).map((item) => item.code);

test("A17 fires on an unannotated binding and names the record spelling", () => {
  const reported = advisories('const pair = ["a", 1]\nprint(str(pair.size))\n');
  assert.deepEqual(reported.map((item) => item.code), ["A17"]);
  assert.equal(reported[0]!.written, '["a", 1]');
  assert.equal(
    reported[0]!.message,
    "A List holds one element type, so every value read back out of '[\"a\", 1]' is 'string | number'."
    + " VelarScript spells a fixed group of differently typed values as a record, which gives each one a name —"
    + " write '{text: \"a\", count: 1}', or declare a type for it",
  );
});

test("A17 carries no mechanical fix, because the field names are a judgement", () => {
  assert.deepEqual(advisories('const pair = ["a", 1]\nprint(str(pair.size))\n').map((item) => item.fix), [undefined]);
});

test("A17 fires on a body-inferred return, an arrow body, and an enum beside a string", () => {
  const inferred = advisories([
    "def locate(text: string):",
    "    return [text.upper(), text.size]",
    'print(str(locate("ab").size))',
    "",
  ].join("\n"));
  assert.deepEqual(inferred.map((item) => item.code), ["A17"]);
  assert.equal(inferred[0]!.written, "[text.upper(), text.size]");
  assert.match(inferred[0]!.message, /write '\{upper: text\.upper\(\), size: text\.size\}'/u);

  const mapped = advisories([
    "def rows(items: List<Item>):",
    "    return items.map(item => [item.name, item.size])",
    "print(str(rows([]).size))",
    "",
  ].join("\n"));
  assert.deepEqual(mapped.map((item) => item.code), ["A17"]);
  assert.equal(mapped[0]!.written, "[item.name, item.size]");
  assert.match(mapped[0]!.message, /write '\{name: item\.name, size: item\.size\}'/u);

  const mixedEnum = advisories('const tagged = [Status.a, "x"]\nprint(str(tagged.size))\n');
  assert.deepEqual(mixedEnum.map((item) => item.code), ["A17"]);
  assert.equal(mixedEnum[0]!.written, '[Status.a, "x"]');
});

test("A17 stays silent wherever a position declared the element type", () => {
  assert.deepEqual(codes('const pair: List<string | number> = ["a", 1]\nprint(str(pair.size))\n'), []);
  assert.deepEqual(codes([
    "def locate(text: string) -> List<string | number>:",
    "    return [text.upper(), text.size]",
    'print(str(locate("ab").size))',
    "",
  ].join("\n")), []);
  assert.deepEqual(codes([
    "type Row:",
    "    cells: List<string | number>",
    "",
    'const row: Row = {cells: ["a", 1]}',
    "print(str(row.cells.size))",
    "",
  ].join("\n")), []);
  assert.deepEqual(codes([
    "def take(values: List<string | number>) -> number:",
    "    return values.size",
    "",
    'print(str(take(["a", 1])))',
    "",
  ].join("\n")), []);
  assert.deepEqual(codes([
    "def apply(transform: (string) -> List<string | number>) -> number:",
    '    return transform("a").size',
    "",
    "print(str(apply(text => [text.upper(), text.size])))",
    "",
  ].join("\n")), []);
});

test("A17 stays silent on one element type, on null items, on two enums, and on records", () => {
  assert.deepEqual(codes('const withNull = ["a", null]\nprint(str(withNull.size))\n'), []);
  assert.deepEqual(codes("const numbers = [1, 2.5]\nprint(str(numbers.size))\n"), []);
  assert.deepEqual(codes("const oneEnum = [Status.a, Status.b]\nprint(str(oneEnum.size))\n"), []);
  assert.deepEqual(codes("const twoEnums = [Kind.a, Status.b]\nprint(str(twoEnums.size))\n"), []);
  assert.deepEqual(codes("const records = [{a: 1}, {b: 2}]\nprint(str(records.size))\n"), []);
});

test("A17 stays silent when any item is outside the primitive categories", () => {
  assert.deepEqual(codes([
    "def boundary(value: unknown):",
    '    const mixed = [value, "a", 1]',
    "    return mixed.size",
    "print(str(boundary(1)))",
    "",
  ].join("\n")), []);
  assert.deepEqual(codes([
    'const known = ["a", 1]   // velar-allow A17: proven separately',
    'const spread = [...known, true]',
    "print(str(spread.size))",
    "",
  ].join("\n")), []);
});

test("A17 stays silent on an empty and on a single-element literal", () => {
  assert.deepEqual(codes("const empty: List<string> = []\nprint(str(empty.size))\n"), []);
  assert.deepEqual(codes('const single = ["a"]\nprint(str(single.size))\n'), []);
});

test("a reasoned velar-allow A17 silences the line, and a stale one is a compile error", () => {
  const suppressed = compile(
    `${declarations}const pair = ["a", 1]   // velar-allow A17: the wire format is a positional pair\nprint(str(pair.size))\n`,
  );
  assert.deepEqual(suppressed.diagnostics, []);
  assert.deepEqual(suppressed.advisories, []);
  assert.notEqual(suppressed.code, null);

  const stale = compile(
    `${declarations}const pair = ["a", "b"]   // velar-allow A17: not a tuple at all\nprint(str(pair.size))\n`,
  );
  assert.deepEqual(stale.diagnostics.map((item) => item.code), ["VEL1012"]);
  assert.match(stale.diagnostics[0]!.message, /No A17 advisory is reported on this line/u);
});

test("A17 never blocks emission", () => {
  const result = compile(`${declarations}const pair = ["a", 1]\nprint(str(pair.size))\n`);
  assert.deepEqual(result.diagnostics, []);
  assert.notEqual(result.code, null, "an advisory travels in its own list and cannot gate the emit");
});

test("'velar check' exits 0 on a module whose only report is A17 and names the count", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-a16-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modulePath = join(directory, "main.vel");
  await writeFile(modulePath, 'const pair = ["a", 1]\nprint(str(pair.size))\n', "utf8");

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));
  const run = spawn(process.execPath, [cliPath, "check", modulePath], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  run.stdout.setEncoding("utf8");
  run.stderr.setEncoding("utf8");
  run.stdout.on("data", (chunk: string) => { stdout += chunk; });
  run.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const status = await new Promise<number>((resolve) => run.on("close", (code) => resolve(code ?? -1)));

  assert.equal(status, 0, `${stdout}${stderr}`);
  assert.match(`${stdout}${stderr}`, /advisory A17: A List holds one element type/u);
  assert.match(stdout, /Checked 1 module .* — 1 advisory\n$/u);
});
