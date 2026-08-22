import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile, formatSource } from "@velarscript/compiler";
import { VELAR_COLLECTION_LOWERING_EXPORTS } from "../packages/compiler/src/collection-lowering-runtime.ts";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";
import { standardModuleSources } from "../packages/cli/src/standard-modules.ts";
import { quoteReportedText } from "../packages/cli/src/test-output.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function messages(source: string, extensions: readonly unknown[] = []): readonly string[] {
  return compile(source, { extensions: extensions as never }).diagnostics.map((item) => item.message);
}

function clean(source: string): void {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
}

function linkedModuleUrls(): ReadonlyMap<string, string> {
  const sources = standardModuleSources();
  const urls = new Map<string, string>();
  const encode = (source: string): string => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const link = (source: string): string => {
    let linked = source;
    for (const name of sources.keys()) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(urls.get(name)!));
    return linked;
  };
  for (const [name, source] of sources) urls.set(name, encode(source));
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [name, source] of sources) urls.set(name, encode(link(source)));
  }
  return urls;
}

function execute(code: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const urls = linkedModuleUrls();
  let linked = code;
  for (const [name, url] of urls) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(url));
  const result = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: 30_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function run(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  return execution.stdout;
}

interface CliProject {
  readonly root: string;
  cli(...commandArguments: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string };
}

/**
 * A real project on disk driven through the `velar` entry point. NEW-D1 is the
 * reason this exists: every CLI entry compiles with shared runtime modules,
 * while `compileCore` inlines them, so a defect in the shared-module wiring is
 * invisible to a compile-level test and green against a broken product.
 */
async function cliProject(files: Readonly<Record<string, string>>, web = false): Promise<CliProject> {
  const root = await mkdtemp(join(tmpdir(), "velar-wave-c2-"));
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    ...(web ? { extensions: ["@velarscript/web"] } : {}),
  }), "utf8");
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, source, "utf8");
  }
  return {
    root,
    cli(...commandArguments) {
      const result = spawnSync(process.execPath, [cliPath, ...commandArguments], { cwd: root, encoding: "utf8", timeout: 120_000 });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
  };
}

// ---------------------------------------------------------------------------
// NEW-D1 — IndexError on every CLI path
// ---------------------------------------------------------------------------

test("[NEW-D1] a project build reaches IndexError, which every CLI entry compiles through shared runtime modules", async () => {
  const project = await cliProject({
    "src/main.vel": `
def main():
    const values: List<number> = [1, 2, 3]
    try:
        print(str(values[9]))
    catch error:
        print("code=" + error.code)
        if error is IndexError:
            print("narrowed")
    return null

main()
`.trimStart(),
  });
  try {
    const run = project.cli("run", ".");
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "code=IndexError\nnarrowed\n");
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[NEW-D1] the shared collection lowering module exports every runtime name the emitter can reference", () => {
  assert.ok((VELAR_COLLECTION_LOWERING_EXPORTS as readonly string[]).includes("__VelarIndexError"));
});

// ---------------------------------------------------------------------------
// NEW-D3 — `unknown` satisfies no bound
// ---------------------------------------------------------------------------

test("[NEW-D3] an unknown argument is rejected by a bounded type parameter at the call site", () => {
  const reported = messages(`
def show<T: Text>(value: T):
    print(str(value))
    return null

def probe(raw: unknown):
    show(raw)
    return null
`.trimStart());
  assert.deepEqual(reported, [
    "Type parameter 'T' is bound by Text, so this argument cannot be unknown; "
    + "a Text parameter accepts the types with a hook-free text form — strings, numbers, bools, enums, and null",
  ]);
});

test("[NEW-D3] an unknown-typed contract is rejected where a bounded generic is used as a value", () => {
  const reported = messages(`
def show<T: Text>(value: T):
    print(str(value))
    return null

def apply(handler: (unknown) -> null, raw: unknown):
    handler(raw)
    return null

apply(show, 42)
`.trimStart());
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /Type parameter 'T' is bound by Text.*solves it to unknown/u);
});

test("[NEW-D3] a concrete argument still solves the parameter when another argument is unknown", () => {
  clean(`
def pick<T: Text>(first: T, second: T) -> string:
    return f"{first}{second}"

def probe(raw: number):
    print(pick(1, raw))
    return null
`.trimStart());
});

// ---------------------------------------------------------------------------
// NEW-D4 + rule 102 — derived disposal chains, and cannot add awaiting
// ---------------------------------------------------------------------------

test("[rule 102] a derived '@dispose' runs before the base's, and both run", () => {
  const output = run(`
class BaseHandle:
    const label: string

    constructor(label: string):
        self.label = label

    @dispose:
        print("base " + self.label)

class DerivedHandle extends BaseHandle:
    constructor(label: string):
        super(label)

    @dispose:
        print("derived " + self.label)

def main():
    using owned = DerivedHandle("report")
    print("body")
    return null

main()
`.trimStart());
  assert.equal(output, "body\nderived report\nbase report\n");
});

test("[rule 102] the base release still runs when the derived part throws, and the first error propagates", () => {
  const result = compile(`
class BaseHandle:
    @dispose:
        print("base released")

class DerivedHandle extends BaseHandle:
    @dispose:
        throw Error("derived release failed")

def main():
    using owned = DerivedHandle()
    print("body")
    return null

main()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.notEqual(execution.status, 0);
  assert.match(execution.stdout, /body\nbase released/u);
  assert.match(execution.stderr, /derived release failed/u);
});

test("[NEW-D4] a subclass cannot start awaiting in '@dispose' where its base releases without awaiting", () => {
  const reported = messages(`
class BaseHandle:
    @dispose:
        print("base")

class DerivedHandle extends BaseHandle:
    @dispose:
        await Promise.sleep(1ms)
        print("derived")
`.trimStart());
  assert.deepEqual(reported, [
    "Class 'DerivedHandle' awaits in '@dispose', but 'BaseHandle' releases without awaiting; "
    + "a 'using' that owns this value through 'BaseHandle' would not await the release — "
    + "move the awaiting work into the base's '@dispose', or release it there",
  ]);
});

test("[NEW-D4] an awaiting base carries every subclass, so owning through either type needs an async scope", () => {
  const reported = messages(`
class BaseHandle:
    @dispose:
        await Promise.sleep(1ms)

class DerivedHandle extends BaseHandle:
    @dispose:
        print("derived")

def main():
    using owned = DerivedHandle()
    return null
`.trimStart());
  assert.deepEqual(reported, [
    "Releasing DerivedHandle awaits, so its 'using' needs an async scope; declare the enclosing function 'async def'",
  ]);
});

// ---------------------------------------------------------------------------
// NEW-D5 — a JavaScript handle has a spelling that works
// ---------------------------------------------------------------------------

test("[NEW-D5] 'using' over an unsafe JavaScript value is rejected instead of degrading to a plain const", async () => {
  const project = await cliProject({
    "node_modules/handle-sdk/package.json": JSON.stringify({ name: "handle-sdk", type: "module", exports: "./index.js" }),
    "node_modules/handle-sdk/index.js": "export function openHandle(name) { return { name, close() { console.log('closed ' + name); } }; }\n",
    "src/main.vel": `
import js unsafe {openHandle} from "handle-sdk"

def main():
    using handle = openHandle("report")
    print("body")
    return null

main()
`.trimStart(),
  });
  try {
    const checked = project.cli("check", ".");
    assert.equal(checked.status, 1, checked.stdout);
    // D90 R17: the unsafe import is unknown now — the call is refused toward
    // a declaration, and the `using` refusal reads `unknown` for the same
    // value.
    assert.match(checked.stderr, /VEL4001: Cannot call an unknown JavaScript value without a declaration or validation/u);
    assert.match(checked.stderr, /VEL4032: 'using' releases a value whose type declares '@dispose'; unknown does not; a JavaScript value carries no release contract; hold it in a field of a VelarScript class whose '@dispose:' block releases it, then own that wrapper/u);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[NEW-D5] an extern class is told to compose, and the composition spelling actually releases", async () => {
  const project = await cliProject({
    "node_modules/handle-sdk/package.json": JSON.stringify({ name: "handle-sdk", type: "module", exports: "./index.js" }),
    "node_modules/handle-sdk/index.js": `
export class Handle {
  constructor(name) { this.name = name; }
  close() { console.log("closed " + this.name); return null; }
}
export function openHandle(name) { return new Handle(name); }
`.trimStart(),
    "src/direct.vel": `
extern module "handle-sdk":
    export class Handle:
        def close() -> null

    export def openHandle(name: string) -> Handle

import js {openHandle} from "handle-sdk"

def main():
    using handle = openHandle("report")
    return null

main()
`.trimStart(),
    "src/main.vel": `
extern module "handle-sdk":
    export class Handle:
        def close() -> null

    export def openHandle(name: string) -> Handle

import js {Handle, openHandle} from "handle-sdk"

class OwnedHandle:
    const handle: Handle

    constructor(name: string):
        self.handle = openHandle(name)

    @dispose:
        self.handle.close()

def main():
    using owned = OwnedHandle("report")
    print("body")
    return null

main()
`.trimStart(),
  });
  try {
    const direct = project.cli("check", "src/direct.vel");
    assert.equal(direct.status, 1, direct.stdout);
    assert.match(direct.stderr, /an extern class declares the foreign shape and cannot declare '@dispose:'; hold it in a field of a VelarScript class whose '@dispose:' block releases it, then own that wrapper/u);
    const composed = project.cli("run", ".");
    assert.equal(composed.status, 0, composed.stderr);
    assert.equal(composed.stdout, "body\nclosed report\n");
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// NEW-D6 + rule 106 — a permanent namespace is not a value
// ---------------------------------------------------------------------------

test("[rule 106] a permanent namespace is rejected everywhere but the head of a member access", () => {
  for (const [source, namespace] of [
    ["const copy = {...Json}\n", "Json"],
    ["print(Json)\n", "Json"],
    ["const {stringify} = Json\n", "Json"],
    ["export const alias = Text\n", "Text"],
    ["const values = [Promise]\n", "Promise"],
  ] as const) {
    const reported = messages(source);
    assert.equal(reported.length, 1, `${source}: ${reported.join(" | ")}`);
    assert.match(reported[0]!, new RegExp(`^'${namespace}' is a namespace, not a value;`, "u"));
    assert.match(reported[0]!, /a namespace cannot be called, passed, stored, spread, or destructured$/u);
  }
});

test("[rule 106] member access on a namespace stays legal, and its members are ordinary values", () => {
  const output = run(`
const encode = Json.stringify
print(encode({a: 1}))
print(Text.slug("Hello World"))
`.trimStart());
  assert.equal(output, '{"a":1}\nhello-world\n');
});

// ---------------------------------------------------------------------------
// NEW-D7 — the Error contract's own members
// ---------------------------------------------------------------------------

test("[NEW-D7] an Error subclass cannot redeclare the contract's members in any binding form", () => {
  for (const [field, expected] of [
    ["const name: string = \"Forged\"", "'name' is the Error contract's own member"],
    ["const code: string = \"Forged\"", "'code' is the Error contract's own member"],
    ["const message: string = \"replaced\"", "'message' is the Error contract's own member"],
    ["let name: string = \"Forged\"", "'name' is the Error contract's own member"],
    ["const stack: string? = null", "'stack' is the Error contract's own member"],
    ["const cause: unknown = null", "'cause' is the Error contract's own member"],
  ] as const) {
    const reported = messages(`
class TimeoutError extends Error:
    ${field}

    constructor(message: string):
        super(message)
`.trimStart());
    assert.equal(reported.length, 1, `${field}: ${reported.join(" | ")}`);
    assert.ok(reported[0]!.startsWith(expected), reported[0] ?? "");
  }
});

test("[NEW-D7] a constructor parameter binding cannot redeclare a contract member either", () => {
  const reported = messages(`
class TimeoutError extends Error:
    constructor(const name: string):
        super(name)
`.trimStart());
  assert.equal(reported.length, 1);
  assert.ok(reported[0]!.startsWith("'name' is the Error contract's own member"), reported[0] ?? "");
});

// ---------------------------------------------------------------------------
// NEW-D8 — `velar fix` reports what it changed
// ---------------------------------------------------------------------------

test("[NEW-D8] a failed write is named and the rewrites that already landed are still reported", {
  // chmod does not make a file unwritable on Windows; the contract is covered
  // on both POSIX CI hosts while the rest of `velar fix` remains cross-platform.
  skip: process.platform === "win32",
}, async () => {
  const project = await cliProject({
    "src/other.vel": "export const c: Array<number> = [3]\n",
    "src/main.vel": `
import {c} from "./other.vel"
const a: Array<number> = [1]
print(str(a.size + c.size))
`.trimStart(),
  });
  try {
    await chmod(join(project.root, "src", "other.vel"), 0o444);
    const fixed = project.cli("fix", ".");
    assert.equal(fixed.status, 1, fixed.stdout);
    assert.match(fixed.stdout, /src\/main\.vel:2:10 fixed VEL2012/u);
    assert.match(fixed.stdout, /applied 1 mechanical fix in 1 file; 1 file could not be written/u);
    assert.match(fixed.stderr, /velar fix: could not write src\/other\.vel/u);
  } finally {
    await chmod(join(project.root, "src", "other.vel"), 0o644).catch(() => undefined);
    await rm(project.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// NEW-D9 — the formatter keeps the space before a list literal
// ---------------------------------------------------------------------------

test("[NEW-D9] a list literal after a keyword keeps its space, and an index access still has none", () => {
  const source = `
def main():
    const values: List<number> = [1, 2, 3]
    for i in [1, 2]:
        print(str(i))
    if 1 in [1, 2]:
        print(str(values[0]))
    if not [1, 2].has(3):
        print("no")
    return null

main()
`.trimStart();
  assert.equal(formatSource(source), source);
  const squeezed = source.replace("in [1, 2]:", "in[1, 2]:");
  assert.equal(formatSource(squeezed), source);
  clean(source);
});

// ---------------------------------------------------------------------------
// Rule 101 — an owned resource does not leave its scope
// ---------------------------------------------------------------------------

test("[rule 101] returning, aliasing, storing, and capturing an owned handle are all rejected", () => {
  const prelude = `
class Handle:
    let open: bool = true

    @dispose:
        self.open = false

let leaked: Handle? = null

def borrow(handle: Handle) -> bool:
    return handle.open
`.trimStart();
  for (const body of [
    "def escape() -> Handle:\n    using handle = Handle()\n    return handle\n",
    "def escape() -> Handle:\n    using handle = Handle()\n    const alias = handle\n    return alias\n",
    "def escape():\n    using handle = Handle()\n    leaked = handle\n    return null\n",
    "def escape() -> () -> bool:\n    using handle = Handle()\n    return () => handle.open\n",
    "def escape() -> List<Handle>:\n    using handle = Handle()\n    return [handle]\n",
  ]) {
    const reported = messages(`${prelude}\n${body}`);
    assert.equal(reported.length, 1, `${body}: ${reported.join(" | ")}`);
    assert.match(reported[0]!, /^'handle' is owned by this scope, which releases it on the way out/u);
    assert.match(reported[0]!, /move the 'using' up to the scope that really owns it/u);
  }
});

test("[rule 101] borrowing, reading data out, and a same-scope alias stay legal", () => {
  clean(`
class Handle:
    let open: bool = true

    @dispose:
        self.open = false

def borrow(handle: Handle) -> bool:
    return handle.open

def legalBorrow() -> bool:
    using handle = Handle()
    return borrow(handle)

def legalData() -> bool:
    using handle = Handle()
    return handle.open

def legalLocal() -> bool:
    using handle = Handle()
    let inner = handle
    return inner.open
`.trimStart());
});

// ---------------------------------------------------------------------------
// Rule 103 — `try` does not swallow the compiler's integrity guards
// ---------------------------------------------------------------------------

test("[rule 103] IndexError passes through a 'try' expression instead of becoming null", () => {
  const result = compile(`
def main():
    const values: List<number> = [1, 2, 3]
    print(str(try values[0]))
    print(str(try values[9]))
    return null

main()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.notEqual(execution.status, 0);
  assert.equal(execution.stdout, "1\n");
  assert.match(execution.stderr, /IndexError/u);
});

test("[rule 103] an assertion failure and a narrowing failure are not converted either", () => {
  const assertion = compile(`
def guard(width: number) -> number:
    assert 0 < width else "Width must be positive"
    return width

print(str(try guard(0)))
`.trimStart());
  assert.deepEqual(assertion.diagnostics, []);
  const execution = execute(assertion.code ?? "");
  assert.notEqual(execution.status, 0);
  assert.match(execution.stderr, /AssertionError/u);
});

test("[rule 103] a 'catch' block still receives all three, because a catch is explicit", () => {
  const output = run(`
def main():
    const values: List<number> = [1]
    try:
        print(str(values[9]))
    catch error:
        if error is IndexError:
            print("caught " + error.code)
    return null

main()
`.trimStart());
  assert.equal(output, "caught IndexError\n");
});

test("[rule 103] Promise.retry surfaces an integrity failure instead of retrying past it", () => {
  const output = run(`
async def broken() -> number:
    const values: List<number> = [1]
    return values[5]

async def main():
    try:
        print(str(await Promise.retry(broken, 3, 1ms)))
    catch error:
        print("retry surfaced " + error.code)
    return null

async main()
`.trimStart());
  assert.equal(output, "retry surfaced IndexError\n");
});

// ---------------------------------------------------------------------------
// Rule 104 — all twelve Bidi_Control code points
// ---------------------------------------------------------------------------

test("[rule 104] LRM, RLM, and ALM are rejected in source beside the nine already banned", () => {
  for (const [point, label] of [["‎", "200E"], ["‏", "200F"], ["؜", "061C"]] as const) {
    for (const source of [`const value = "a${point}b"\n`, `// comment ${point}\n`, `const ${point}name = 1\n`]) {
      const reported = messages(source);
      assert.ok(
        reported.some((message) => message.startsWith(`Bidirectional control U+${label} cannot appear directly`)),
        `${label}: ${reported.join(" | ")}`,
      );
    }
  }
});

test("[rule 104] the escape spelling and the emoji-composing characters stay legal", () => {
  clean('const value = "a\\u{202E}b"\nconst family = "\\u{1F468}\\u{200D}\\u{1F469}"\nprint(value + family)\n');
});

// ---------------------------------------------------------------------------
// Rule 105 — the reporter escapes the author text it quotes
// ---------------------------------------------------------------------------

test("[rule 105] reported author text is a JSON string with every bidi control escaped", () => {
  assert.equal(quoteReportedText("plain name"), '"plain name"');
  assert.equal(quoteReportedText("pass ‮ fail"), '"pass \\u202E fail"');
  assert.equal(quoteReportedText("‎‏؜⁦⁩"), '"\\u200E\\u200F\\u061C\\u2066\\u2069"');
  assert.equal(quoteReportedText('quote " and \\'), '"quote \\" and \\\\"');
});

test("[rule 105] a bidi-named test cannot reorder the verdict line", async () => {
  const project = await cliProject({
    "src/main.vel": "print(\"app\")\n",
    "src/app.test.vel": `
import {expect} from "velar/test"

test "pass \\u{202E} fail":
    expect(1).toBe(1)
`.trimStart(),
  });
  try {
    const tested = project.cli("test", ".");
    assert.equal(tested.status, 0, tested.stderr);
    assert.match(tested.stdout, /✓ "src\/app\.test\.vel" :: "pass \\u202E fail"/u);
    assert.ok(!tested.stdout.includes("‮"), "the raw control reached the verdict line");
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Rule 107 — `is` is the only discrimination authority
// ---------------------------------------------------------------------------

test("[rule 107] a relabelled host error reports code 'Error' while its own classes keep their names", async () => {
  const project = await cliProject({
    "node_modules/spoof-sdk/package.json": JSON.stringify({ name: "spoof-sdk", type: "module", exports: "./index.js" }),
    "node_modules/spoof-sdk/index.js": `
export function boom() {
  const error = new TypeError("host failure");
  error.name = "FileNotFoundError";
  error.code = "SPOOFED";
  throw error;
}
`.trimStart(),
    "src/main.vel": `
extern module "spoof-sdk":
    export def boom() -> null

import js {boom} from "spoof-sdk"

class TimeoutError extends Error:
    constructor(message: string):
        super(message)

def main():
    try:
        boom()
    catch error:
        print("host code=" + error.code + " name=" + error.name + " is=" + str(error is FileNotFoundError))
    try:
        throw TimeoutError("slow")
    catch error:
        print("own code=" + error.code + " is=" + str(error is TimeoutError))
    const values: List<number> = [1]
    try:
        print(str(values[9]))
    catch error:
        print("builtin code=" + error.code)
    return null

main()
`.trimStart(),
  });
  try {
    const ran = project.cli("run", ".");
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout, [
      "host code=Error name=FileNotFoundError is=false",
      "own code=TimeoutError is=true",
      "builtin code=IndexError",
      "",
    ].join("\n"));
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Rule 108 — a JSX attribute is a typed position
// ---------------------------------------------------------------------------

test("[rule 108] an empty list literal in a JSX attribute infers the declared prop type", () => {
  const reported = messages(`
type Item:
    id: string

component ItemList(items: List<Item>):
    return <p>{str(items.size)}</p>

export component App():
    return <ItemList items={[]} />
`.trimStart(), [webCompilerExtension]);
  assert.deepEqual(reported, []);
});

// ---------------------------------------------------------------------------
// Rule 109 — the bound vocabulary is reserved
// ---------------------------------------------------------------------------

test("[rule 109] a user type, class, enum, alias, or type parameter cannot take a bound's name", () => {
  for (const [source, name, noun] of [
    ["type Data:\n    id: string\n", "Data", "type"],
    ["type Text = string\n", "Text", "type"],
    ["class Comparable:\n    pass\n", "Comparable", "class"],
    ["enum Data:\n    one\n", "Data", "enum"],
    ["def save<Data>(value: Data):\n    return null\n", "Data", "type parameter"],
  ] as const) {
    const reported = messages(source);
    assert.ok(
      reported.some((message) => message
        === `'${name}' is a reserved type-parameter bound — the bounds are Comparable, Text, Data — so it cannot also name a ${noun}; rename this declaration`
        || message
        === `'${name}' is a reserved type-parameter bound — the bounds are Comparable, Text, Data — so it cannot also name a ${noun}; rename it`),
      `${source}: ${reported.join(" | ")}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Audit 12 INCONSISTENT items
// ---------------------------------------------------------------------------

test("[audit 12] the retirement guidance names the spelling that survives, in one round", () => {
  for (const [source, expected] of [
    ['print("a".trimStart())\n', "Use Text.trimStart(value); string operations beyond the core members live in the Text namespace, which needs no import"],
    ['print("a".lstrip())\n', "Use Text.trimStart(value); string operations beyond the core members live in the Text namespace, which needs no import"],
    ['print("a".title())\n', "Use Text.title(value); string operations beyond the core members live in the Text namespace, which needs no import"],
    ['print("a".splitlines().join(""))\n', "Use Text.lines(value); it splits on line boundaries, and the Text namespace needs no import"],
  ] as const) {
    const reported = messages(source);
    assert.ok(reported.includes(expected), `${source}: ${reported.join(" | ")}`);
    for (const message of reported) assert.ok(!message.includes("velar/text"), message);
  }
});

test("[audit 12] check, build, and fix all see a '*.test.vel' module", async () => {
  const project = await cliProject({
    "src/main.vel": "print(\"app\")\n",
    "src/app.test.vel": `
import {expect} from "velar/test"

test "typed":
    const n: number = "not a number"
    expect(n).toBe(1)
`.trimStart(),
  });
  try {
    for (const command of ["check", "build"] as const) {
      const result = project.cli(command, ".");
      assert.equal(result.status, 1, `${command}: ${result.stdout}`);
      assert.match(result.stderr, /src\/app\.test\.vel:4:23 error VEL4001: Cannot assign string to number/u);
    }
    await writeFile(join(project.root, "src", "app.test.vel"), `
import {expect} from "velar/test"

test "typed":
    const values: Array<number> = [1]
    expect(values.size).toBe(1)
`.trimStart(), "utf8");
    const fixed = project.cli("fix", ".");
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.match(fixed.stdout, /src\/app\.test\.vel:4:19 fixed VEL2012/u);
    const checked = project.cli("check", ".");
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /Checked 2 modules/u);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[audit 12] a cleanup hook and a component watch body own resources like every other scope", () => {
  const reported = messages(`
class Handle:
    let open: bool = true

    @dispose:
        self.open = false

component App:
    state local: number = 0

    watch local:
        using watched = Handle()
        print(str(watched.open))

    @cleanup:
        using released = Handle()
        print(str(released.open))

    return <div>{str(local)}</div>
`.trimStart(), [webCompilerExtension]);
  assert.deepEqual(reported, []);
});

test("[audit 12] a component body still has no scope to release at", () => {
  const reported = messages(`
class Handle:
    let open: bool = true

    @dispose:
        self.open = false

component App:
    using handle = Handle()

    return <div>{str(handle.open)}</div>
`.trimStart(), [webCompilerExtension]);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /A component body builds the component and does not end/u);
});

test("[audit 12] 'test name:' is told the name is a string rather than called an unknown keyword", () => {
  const reported = messages("test name:\n    print(\"x\")\n");
  assert.ok(
    reported.includes('A test name is the sentence a report prints, so it is written as a string — \'test "name":\''),
    reported.join(" | "),
  );
});

test("[audit 12] 'using' works on the structurally declared capability handles", async () => {
  const node = await cliProject({
    "src/main.vel": `
import {terminal} from "velar/terminal"

async def main():
    using session = terminal
    await session.write("owned\\n")
    return null

async main()
`.trimStart(),
  });
  try {
    const ran = node.cli("run", ".");
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /owned/u);
  } finally {
    await rm(node.root, { recursive: true, force: true });
  }

  const web = await cliProject({
    "src/main.vel": `
import {eventStream, socket} from "velar/realtime"

export component App():
    action connect():
        using live = socket("wss://example.com")
        live.send("ping")

    action listen():
        using stream = eventStream("https://example.com/events")
        print(stream.state())

    return <button on:click={connect}>connect</button>
`.trimStart(),
  }, true);
  try {
    const checked = web.cli("check", ".");
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    await rm(web.root, { recursive: true, force: true });
  }
});

test("[audit 12] a user record with a close() is still never detected as ownable", () => {
  const reported = messages(`
type Fake:
    close: () -> null

def own(value: Fake):
    using handle = value
    return null
`.trimStart());
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /VelarScript|'using' releases a value whose type declares '@dispose'/u);
  assert.match(reported[0]!, /a record is data, so it has nothing to release/u);
});

test("[audit 12] a JSX attribute value accepts the language's backtick delimiter", () => {
  const reported = messages(`
export component App():
    return <div title=\`He said "hi"\` class='single'>text</div>
`.trimStart(), [webCompilerExtension]);
  assert.deepEqual(reported, []);
});
