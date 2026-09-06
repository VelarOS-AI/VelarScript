import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { formatSource } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { webFormatOptions, compile, inspectModule } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("predeclares top-level functions and rejects incomplete typed returns", () => {
  const forward = compile(`
def first() -> number:
    return second()

def second() -> number:
    return 2
`.trimStart());
  assert.deepEqual(forward.diagnostics, []);

  const incomplete = compile(`
def choose(flag: bool) -> number:
    if flag:
        return 1
`.trimStart());
  assert.ok(incomplete.diagnostics.some((item) => item.code === "VEL4006"));
});

test("formatter is syntax-aware and idempotent", () => {
  // The action keeps a written result so the fixture still covers '->' inside a
  // declaration line followed by the block colon. It is not '-> null': D58 rule
  // 139 refuses that spelling where a body infers it, and the corpus an author
  // reads should not model a spelling the compiler rejects. The type alias on
  // the first line keeps '-> null' covered where it is still written.
  const source = "type ChooseHandler=(string)->null  \r\ncomponent App:  \r\n\t// keep me\r\n\tresource label:string=loadLabel()   \r\n\tconst values:List<number>=[1,2,3]\r\n\tconst choose:ChooseHandler=value=>null\r\n\tconst result=ready?values[0]:null\r\n\taction refresh()->string:\r\n\t\tawait label.reload()\r\n\t\treturn \"done\"\r\n\treturn <main>{label.value}</main>\r\n";
  const formatted = formatSource(source, webFormatOptions);
  assert.equal(formatted, "type ChooseHandler = (string) -> null\ncomponent App:\n    // keep me\n    resource label: string = loadLabel()\n    const values: List<number> = [1, 2, 3]\n    const choose: ChooseHandler = value => null\n    const result = ready ? values[0] : null\n    action refresh() -> string:\n        await label.reload()\n        return \"done\"\n    return <main>{label.value}</main>\n");
  assert.equal(formatSource(formatted, webFormatOptions), formatted);
});

test("formatter keeps destructuring, grouped conditions, and optional parameter types unambiguous", () => {
  const source = `import js {format} from "pkg"
const {name: displayName} = user
const visible = ready and (active or pending)
const same = TaskPriority.is(TaskPriority.high)
def find(value: Ticket?, previous: Ticket?) -> Ticket?: return [ready ? value : previous]
`;
  const formatted = formatSource(source);
  assert.equal(formatted, `import js {format} from "pkg"
const {name: displayName} = user
const visible = ready and (active or pending)
const same = TaskPriority.is(TaskPriority.high)
def find(value: Ticket?, previous: Ticket?) -> Ticket?: return [ready ? value : previous]
`);
  assert.equal(formatSource(formatted), formatted);
});

test("formatter preserves natural negative membership and type tests", () => {
  const source = `const value: unknown=[]
const names=["Ada"]
const absent=value   is   not List < string >
const missing="Lin"not   in names
`;
  const formatted = formatSource(source);
  assert.equal(formatted, `const value: unknown = []
const names = ["Ada"]
const absent = value is not List<string>
const missing = "Lin" not in names
`);
  assert.deepEqual(inspectModule(formatted).diagnostics, []);
  assert.equal(formatSource(formatted), formatted);
});

test("formatter does not confuse capitalized values with generic types", () => {
  const source = `const lower = Player < score
const bounded = Player < score and score > Limit
const values: List<Player> = []
`;
  const formatted = formatSource(source);
  assert.equal(formatted, source);
  assert.deepEqual(inspectModule(formatted).diagnostics, []);
  assert.equal(formatSource(formatted), formatted);

  // A mixed-direction chain is no longer a compilable comparison (D30 item 20),
  // but the formatter still has to read '<' and '>' as operators rather than a
  // generic argument list, so the text round-trips unchanged and the rejection
  // is the chain rule rather than a parse cascade.
  const mixed = "const chained = value < Other > limit\n";
  assert.equal(formatSource(mixed), mixed);
  assert.deepEqual(inspectModule(mixed).diagnostics.map((item) => item.code), ["VEL2031"]);
});

test("formatter keeps structural match patterns compact and unambiguous", () => {
  const formatted = formatSource("match value:\n  case {kind:\"user\",data:[first,...rest],...details} as payload if details.active:\n    print(payload)\n");
  assert.equal(formatted, `match value:
    case {kind: "user", data: [first, ...rest], ...details} as payload if details.active: print(payload)
`);
  assert.deepEqual(inspectModule(formatted).diagnostics, []);
  assert.equal(formatSource(formatted), formatted);
});

test("formatter preserves multiline JSX while formatting surrounding syntax", () => {
  const formatted = formatSource(`
component App:
  const label="Ready"
  return <main>
    <button type="button">
      {label}
    </button>
  </main>
`.trimStart(), webFormatOptions);
  assert.match(formatted, /const label = "Ready"/u);
  assert.match(formatted, /<\/button>\n    <\/main>/u);
  assert.deepEqual(compile(formatted).diagnostics, []);
  assert.equal(formatSource(formatted, webFormatOptions), formatted);
});

test("CLI format supports write and check modes", async () => {
  const directory = await makeTemporaryDirectory("velar-format-");
  const sourcePath = join(directory, "main.vel");
  await writeFile(sourcePath, "def main():  \n  return null  \n", "utf8");

  const before = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "format", sourcePath, "--check"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(before.status, 1);
  const write = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "format", sourcePath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(write.status, 0, write.stderr);
  const after = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "format", sourcePath, "--check"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(await readFile(sourcePath, "utf8"), "def main(): return null\n");
});

test("documentation example checker rejects invalid complete examples", async () => {
  const directory = await makeTemporaryDirectory("velar-doc-example-");
  const markdownPath = join(directory, "guide.md");
  await writeFile(markdownPath, "```velar\nconst enabled = True\n```\n", "utf8");

  const execution = spawnSync(process.execPath, ["scripts/check-documentation-examples.mjs", markdownPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /VEL1005/u);
});

test("documentation example checker analyzes fragments, not just their syntax", async () => {
  const directory = await makeTemporaryDirectory("velar-doc-fragment-");
  // Every one of these parses cleanly, so a parse-level fragment check reported
  // nothing; each is rejected by `velar check`, so the gate must reject it too.
  const rejected = [
    ["assignment type", "const x: string = 1\n", /Cannot assign number to string/u],
    ["bare optional condition", "def label(name: string?) -> string:\n    if name:\n        return name\n    return \"anonymous\"\n", /A condition judges truth, not presence/u],
    ["optional operand", "def ready(name: string?, active: bool) -> bool:\n    return name and active\n", /A condition judges truth, not presence/u],
    ["reserved any annotation", "let value: any = 1\nprint(value)\n", /'any' is not a VelarScript type/u],
    [
      "web semantics",
      "type EditorHandle:\n    focus: () -> null\n\ncomponent Page:\n    let editor: EditorHandle? = null\n\n    @mounted:\n        if editor:\n            editor.focus()\n\n    return <Editor ref={editor} />\n",
      /A condition judges truth, not presence/u,
    ],
  ] as const;
  for (const [name, source, expected] of rejected) {
    const path = join(directory, `${name.replaceAll(" ", "-")}.md`);
    await writeFile(path, `\`\`\`velar fragment\n${source}\`\`\`\n`, "utf8");
    const execution = spawnSync(process.execPath, ["scripts/check-documentation-examples.mjs", path], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(execution.status, 1, `${name}: ${execution.stdout}${execution.stderr}`);
    assert.match(execution.stderr, expected);
  }

  // A real fragment is full of unresolved names; the suppression that keeps
  // those quiet must not swallow the violation standing next to them.
  //
  // CO-I5: the unknown a *resolved* value declares is the one this proves,
  // because an unknown born from an unresolved name now poisons nothing —
  // `for item in items:` over a name the fragment never declares carries the
  // error type into its slot, exactly as `ticket.title` above it already
  // stayed silent. The violation next to them is what the gate must still see.
  const mixed = join(directory, "mixed.md");
  await writeFile(mixed, [
    "```velar fragment",
    "import {Widget} from \"./widget.vel\"",
    "",
    "print(ticket.title)",
    "const x: string = 1",
    "const raw: unknown = Json.parse(\"{}\")",
    "print(f\"{raw.name}\")",
    "for item in items:",
    "    print(item)",
    "print(Widget)",
    "```",
    "",
  ].join("\n"), "utf8");
  const mixedExecution = spawnSync(process.execPath, ["scripts/check-documentation-examples.mjs", mixed], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(mixedExecution.status, 1);
  assert.match(mixedExecution.stderr, /Cannot assign number to string/u);
  assert.match(mixedExecution.stderr, /Cannot access 'name' on unknown without validation/u);

  // What a fragment legitimately omits is its surrounding declarations: the
  // unresolved names, the neighbouring module, and the asset that only exists
  // in the prose stay accepted — but not a diagnostic about the `unknown` they type.
  const accepted = join(directory, "accepted.md");
  await writeFile(accepted, [
    "```velar fragment",
    "import {formatTicket} from \"./format.vel\"",
    "",
    "print(formatTicket(ticket))",
    "for item in items:",
    "    print(item)",
    "```",
    "",
    "```velar fragment",
    "import css unsafe \"./legacy.css\" before look",
    "```",
    "",
  ].join("\n"), "utf8");
  const clean = spawnSync(process.execPath, ["scripts/check-documentation-examples.mjs", accepted], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /2 fragments/u);
});

test("[CO-C1] the one line width the formatter has: 120 columns, and only for a one-statement suite", () => {
  // Charter §2 said "There is no line width" while `format/options.ts` said
  // `FORMAT_PRINT_WIDTH = 120` and `--check` enforced it. The behaviour is the
  // one that is right — choosing between the two suite shapes *is* a width
  // decision — so the charter now states it, and this pins the boundary the
  // charter names.
  const suite = (pad: number): string => `def f${"x".repeat(pad)}() -> string:\n    return "x"\n`;
  const headerLength = (source: string): number => formatSource(source).split("\n")[0]!.length;
  assert.equal(headerLength(suite(91)), 120, "a suite that fits is folded onto its header");
  assert.equal(headerLength(suite(92)), 110, "one column past the width, the suite keeps its own line");

  // Nothing else is reflowed: a long literal stays where it was written, and a
  // suite of two statements is indented however short it is.
  const longLiteral = `const message = "${"y".repeat(200)}"\n`;
  assert.equal(formatSource(longLiteral), longLiteral);
  const twoStatements = 'def f() -> string:\n    const a = "x"\n    return a\n';
  assert.equal(formatSource(twoStatements), twoStatements);

  // And the fold is required, not merely permitted: an indented one-statement
  // suite is *not* formatted, which is what `velar format --check` enforces.
  assert.equal(formatSource('def stop() -> string:\n    return "x"\n'), 'def stop() -> string: return "x"\n');
});
