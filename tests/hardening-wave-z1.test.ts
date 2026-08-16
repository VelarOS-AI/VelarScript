import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "@velarscript/compiler";
import { standardModuleSources } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// Wave Z1 closes the backlog wave N-3 dropped when it landed as documentation
// only (docs/decisions/archive/WAVE-CD-REPORT.md §6.1 and §6.5 item 1): every diagnostic
// and message ticket assigned to that wave, including the three approved user
// rulings D45-76/78/79, plus D38-47, D47-83/85, and the audit's own
// documentation-only items. Each test here asserts the message text a reader
// now gets, because the defect in every one of these was the text.

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.message);
}

function codes(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.code);
}

function compileWeb(source: string): ReturnType<typeof compile> {
  return compile(source, { extensions: [velarCompilerExtension] });
}

// The generated module names its dependencies by specifier, so the standard
// module graph is linked as data URLs before the program runs.
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

function run(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
  let linked = result.code ?? "";
  for (const [name, url] of linkedModuleUrls()) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(url));
  const execution = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: 20_000 });
  assert.equal(execution.status, 0, execution.stderr);
  return execution.stdout;
}

// ---------------------------------------------------------------------------
// CLS-I1: `self` outside an instance body.
// ---------------------------------------------------------------------------

test("[CLS-I1] `self` in a field initializer names the initialization rule, once", () => {
  // The old shape was VEL3001 "Unknown name 'self'" plus two cascades from the
  // unknown type it returned. `self` is not an unknown name; it is a name with
  // a position rule, and the position is the whole lesson.
  assert.deepEqual(messages(`
class Counter:
    let start: number = 0
    let total: number = self.start
`.trimStart()), [
    "'self' is available in constructor, method, and getter bodies; a field initializer runs before the instance is complete, so assign this field in the constructor instead",
  ]);
});

test("[CLS-I1] `self` in a static member points at the class name, once", () => {
  assert.deepEqual(messages(`
class Counter:
    static let total: number = 0

    static def read() -> number:
        return self.total
`.trimStart()), [
    "'self' is available in constructor, method, and getter bodies; a static member has no instance — reach class-owned members through the class name, as in 'Counter.member'",
  ]);

  // A static field initializer is the same absence for the same reason.
  assert.deepEqual(messages(`
class Counter:
    static let seed: number = 1
    static let total: number = self.seed
`.trimStart()), [
    "'self' is available in constructor, method, and getter bodies; a static member has no instance — reach class-owned members through the class name, as in 'Counter.member'",
  ]);
});

test("[CLS-I1] `self` outside a class stays an ordinary unknown name, and instance bodies are untouched", () => {
  assert.deepEqual(messages("def read() -> number:\n    return self.total\n"), [
    "Unknown name 'self'",
    "Cannot access 'total' on unknown without validation",
    "Cannot assign unknown to number",
  ]);
  assert.equal(run(`
class Counter:
    let total: number = 3

    def read() -> number:
        return self.total

print(str(Counter().read()))
`.trimStart()), "3\n");
});

// ---------------------------------------------------------------------------
// CLS-I4 (D45 rule 78): extern classes cannot be extended.
// ---------------------------------------------------------------------------

test("[CLS-I4] extending an extern class teaches composition instead of 'Unknown base class'", () => {
  assert.deepEqual(messages(`
extern module "chart-lib":
    export class Chart:
        def draw() -> string

import js {Chart} from "chart-lib"

class MyChart extends Chart:
    def go() -> string:
        return "x"
`.trimStart()), [
    "Extern class 'Chart' cannot be extended; wrap the instance by composition — hold it in a field and expose the behavior as methods or functions",
  ]);
});

test("[CLS-I4] a genuinely unknown base class keeps its own message, and `extends Error` still works", () => {
  assert.deepEqual(messages("class Widget extends Chart:\n    pass\n"), ["Unknown base class 'Chart'"]);
  assert.deepEqual(messages(`
class TimeoutError extends Error:
    constructor(message: string):
        super(message)
`.trimStart()), []);
});

test("[CLS-I4] composition across the bridge is the shape that works", () => {
  // The diagnostic tells the author to hold the instance in a field, so that
  // shape has to check. It did not: an extern class name in a class-field or
  // record-field annotation froze into a structural named type, the
  // declaration looked clean, and the member read failed with "Type 'Chart'
  // has no field 'draw'". All five annotation positions now resolve to the one
  // extern class.
  assert.deepEqual(messages(`
extern module "chart-lib":
    export class Chart:
        constructor()
        def draw() -> string

import js {Chart} from "chart-lib"

type Holder:
    chart: Chart

class MyChart:
    let spare: Chart

    constructor(private let inner: Chart):
        self.spare = inner

    def go() -> string:
        return self.inner.draw() + self.spare.draw()

def read(holder: Holder) -> string:
    return holder.chart.draw()

const direct: Chart = Chart()
print(direct.draw())
`.trimStart()), []);
});

// ---------------------------------------------------------------------------
// CLS-I5: `readonly` on an executable member.
// ---------------------------------------------------------------------------

test("[CLS-I5] `readonly` on a method, getter, or constructor stops advising `const`", () => {
  const executable = "'readonly' is a data-type modifier, not a class member modifier; a method, getter, or constructor is executable and has no readonly contract — mark the data it works with, as in 'readonly List<number>'";
  assert.deepEqual(messages("class Box:\n    readonly def size() -> number:\n        return 1\n"), [executable]);
  assert.deepEqual(messages("class Box:\n    readonly get size() -> number:\n        return 1\n"), [executable]);
  assert.deepEqual(messages("class Box:\n    readonly constructor():\n        pass\n"), [executable]);
  // An extern class member gets the same lesson under its own code.
  assert.deepEqual(messages(`
extern module "host-sdk":
    export class Client:
        readonly def inspect() -> string
`.trimStart()), [executable]);
});

test("[CLS-I5] `readonly` on a field still points at `const`, which is advice a field can take", () => {
  assert.deepEqual(messages("class Box:\n    readonly let size: number = 1\n"), [
    "'readonly' is a data-type modifier, not a class member modifier; use 'const' for a read-only field",
  ]);
});

// ---------------------------------------------------------------------------
// CLS-U1 (D45 rule 79): classes have no setters.
// ---------------------------------------------------------------------------

test("[CLS-U1] a setter gets one directed rejection instead of three generic cascades", () => {
  // The old shape was VEL2007 twice plus VEL2004, none of which said "there
  // are no setters".
  assert.deepEqual(messages(`
class Box:
    let size: number = 0

    set size(value: number):
        self.size = value
`.trimStart()), [
    "VelarScript classes have no setters; assign the field directly, or declare a method such as 'def setSize(value: T)'",
  ]);
  assert.deepEqual(codes(`
class Box:
    let size: number = 0

    set size(value: number):
        self.size = value
`.trimStart()), ["VEL2007"]);
});

test("[CLS-U1] `set` remains an ordinary member name", () => {
  assert.equal(run(`
class Registry:
    def set(value: number) -> number:
        return value + 1

class Store:
    let set: number = 2

print(str(Registry().set(4)))
print(str(Store().set))
`.trimStart()), "5\n2\n");
});

// ---------------------------------------------------------------------------
// CLS-U7: there is no optional-field syntax.
// ---------------------------------------------------------------------------

test("[CLS-U7] `let x?: T` names the real rule instead of claiming the type is missing", () => {
  // The type is right there; "Class fields require an explicit type" was
  // simply false, and it hid the rule that VelarScript puts the question in
  // the type.
  assert.deepEqual(messages("class Box:\n    let x?: number = 1\n"), [
    "VelarScript has no optional-field syntax; a field carries an optional type instead — write 'let x: number? = null'",
  ]);
  assert.deepEqual(messages("class Box:\n    const label?: string = \"a\"\n"), [
    "VelarScript has no optional-field syntax; a field carries an optional type instead — write 'const label: string? = null'",
  ]);
  // The spelling the message teaches compiles.
  assert.deepEqual(messages("class Box:\n    let x: number? = null\n"), []);
});

test("[CLS-U7] a field with no type at all still reports the missing type", () => {
  assert.deepEqual(messages("class Box:\n    let x = 1\n"), ["Class fields require an explicit type"]);
});

// ---------------------------------------------------------------------------
// CLS-C2: what `super` reaches.
// ---------------------------------------------------------------------------

test("[CLS-C2] the bare-`super` message names getters as well as methods", () => {
  assert.deepEqual(messages(`
class Base:
    let n: number = 1

class Derived extends Base:
    def read() -> number:
        return super
`.trimStart()), [
    "'super' must be followed by a base method or getter name",
    "Cannot assign unknown to number",
  ]);
});

test("[CLS-C2] `super` reaches base methods and getters; a base field is read through `self`", () => {
  assert.equal(run(`
class Base:
    let n: number = 2

    get doubled() -> number:
        return self.n * 2

    def describe() -> string:
        return "base"

class Derived extends Base:
    override def describe() -> string:
        return f"{super.describe()}|{super.doubled}|{self.n}"

print(Derived().describe())
`.trimStart()), "base|4|2\n");
  assert.deepEqual(messages(`
class Base:
    let n: number = 1

class Derived extends Base:
    def read() -> number:
        return super.n
`.trimStart()), [
    "Base class 'Base' has no method or getter 'n'",
    "Cannot assign unknown to number",
  ]);
});

// ---------------------------------------------------------------------------
// LOK-I5: the unit vocabulary belongs to the Web extension.
// ---------------------------------------------------------------------------

test("[LOK-I5] a Web unit in a Core file names the extension that owns it", () => {
  assert.deepEqual(messages("const width = 16px\n"), [
    "The numeric unit 'px' belongs to @velarscript/web; add \"@velarscript/web\" to velar.json extensions, or move this module into a Web project",
  ]);
  assert.deepEqual(messages("const share = 50%\n"), [
    "The numeric unit '%' belongs to @velarscript/web; add \"@velarscript/web\" to velar.json extensions, or move this module into a Web project",
  ]);
  assert.deepEqual(messages("const angle = 45deg\nconst track = 1fr\n"), [
    "The numeric unit 'deg' belongs to @velarscript/web; add \"@velarscript/web\" to velar.json extensions, or move this module into a Web project",
    "The numeric unit 'fr' belongs to @velarscript/web; add \"@velarscript/web\" to velar.json extensions, or move this module into a Web project",
  ]);
  // A percentage inside brackets or an argument list is the same shape.
  assert.deepEqual(messages("const sizes = [50%, 100%]\n"), [
    "The numeric unit '%' belongs to @velarscript/web; add \"@velarscript/web\" to velar.json extensions, or move this module into a Web project",
    "The numeric unit '%' belongs to @velarscript/web; add \"@velarscript/web\" to velar.json extensions, or move this module into a Web project",
  ]);
});

test("[LOK-I5] a unit nobody owns and Core's own durations are unchanged", () => {
  assert.deepEqual(messages("const odd = 16qq\n"), ["Unknown numeric unit 'qq'"]);
  assert.deepEqual(messages("const wait: Duration = 250ms\n"), []);
});

test("[LOK-I5] the remainder operator keeps both of its Core spellings", () => {
  assert.equal(run("const packed = 10%3\nconst spaced = 10 % 3\nprint(str(packed + spaced))\n"), "2\n");
});

test("[LOK-I5] a Web project keeps its units and its own abutting-number guidance", () => {
  assert.deepEqual(compileWeb("const width: Length = 16px\n").diagnostics.map((item) => item.message), []);
  assert.deepEqual(compileWeb("const packed = 10%3\n").diagnostics.map((item) => item.message), [
    "'10%' is a percentage literal, so '3' starts a second statement; write '10 % 3' with spaces for the remainder operator",
  ]);
});

// ---------------------------------------------------------------------------
// MOD-I2 (D50 rule 99): both side-effect import spellings are refused.
// ---------------------------------------------------------------------------

const SIDE_EFFECT_IMPORT = "A module's effects must be visible where they happen; export a function and call it — import {install} from \"./effects.vel\", then install()";

test("[MOD-I2] the bare-string side-effect import is refused with the visible form", () => {
  // D50 rule 99 reversed the ledger's earlier decision to bless this spelling:
  // a side-effect import is invisible action, which is exactly what D43 rule 68
  // excludes decorators for. "Both parents have it" was never sufficient — the
  // language already removed truthiness, coercive equality, and `switch`.
  const result = compile("import \"./effects.vel\"\n\nprint(\"main\")\n");
  assert.deepEqual(result.diagnostics.map((item) => item.message), [SIDE_EFFECT_IMPORT]);
  assert.equal(result.diagnostics[0]?.code, "VEL2029");
  assert.equal(result.code, null);
});

test("[MOD-I2] empty braces are the same import and get the same one message", () => {
  const result = compile("import {} from \"./effects.vel\"\n\nprint(\"main\")\n");
  assert.deepEqual(result.diagnostics.map((item) => item.message), [SIDE_EFFECT_IMPORT]);
  assert.equal(result.diagnostics[0]?.code, "VEL2029");
  // No mechanical rewrite: naming the function to export and call is the
  // author's decision, not a spelling change.
  assert.equal(result.diagnostics[0]?.fix, undefined);
  assert.equal(result.diagnostics[0]?.recovered, undefined);
});

test("[MOD-I2] the refusal never fabricates a dependency on the module it refused", () => {
  // A rejected import contributes no edge, so a missing module cannot pile a
  // resolution failure on top of the one message that matters (MOD-I1/BRG-D1).
  for (const source of ["import \"./effects.vel\"\n", "import {} from \"./effects.vel\"\n"]) {
    assert.equal(compile(source).diagnostics.length, 1);
  }
});

test("[MOD-I2] the named import forms are untouched", () => {
  assert.deepEqual(messages("import {name} from \"./effects.vel\"\n\nprint(name)\n"), []);
  assert.deepEqual(messages("import * as effects from \"./effects.vel\"\n"), []);
  // The default-name expectation still stands for anything that is neither a
  // name nor the refused side-effect string.
  assert.deepEqual(messages("import 3 from \"./effects.vel\"\n").slice(0, 1), ["Expected a default import name"]);
});

test("[MOD-I2] the visible form the message teaches runs the module's effects end to end", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-z1-effects-"));
  try {
    await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel" }), "utf8");
    await writeFile(join(directory, "register.vel"), `
export def install():
    print("registered")
`.trimStart(), "utf8");
    await writeFile(join(directory, "main.vel"), `
import {install} from "./register.vel"

install()
print("ready")
`.trimStart(), "utf8");
    const result = spawnSync(process.execPath, [cliPath, "run", directory], { encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "registered\nready\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[MOD-I2] the refusal is a project-level check too, and `import css unsafe` is exempt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-z1-refuse-"));
  try {
    await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel" }), "utf8");
    await writeFile(join(directory, "register.vel"), "export const name = \"a\"\n", "utf8");
    await writeFile(join(directory, "main.vel"), "import \"./register.vel\"\n\nprint(\"ready\")\n", "utf8");
    const result = spawnSync(process.execPath, [cliPath, "check", directory], { encoding: "utf8", timeout: 120_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /VEL2029: A module's effects must be visible where they happen/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  // The one exempt resource boundary: a stylesheet is not an action, and it has
  // no callable equivalent.
  assert.deepEqual(
    compileWeb("import css unsafe \"./theme.css\" before look\n\nconst width: Length = 16px\n").diagnostics.map((item) => item.message),
    [],
  );
});

// ---------------------------------------------------------------------------
// MOD-U7: a plain import of a JavaScript-only package.
// ---------------------------------------------------------------------------

test("[MOD-U7] a JavaScript-only package import points at the bridge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-z1-package-"));
  try {
    await mkdir(join(directory, "node_modules", "left-pad"), { recursive: true });
    await writeFile(join(directory, "node_modules", "left-pad", "package.json"), JSON.stringify({ name: "left-pad", version: "1.0.0", main: "index.js" }), "utf8");
    await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel" }), "utf8");
    await writeFile(join(directory, "main.vel"), "import {pad} from \"left-pad\"\n\nprint(pad(\"a\"))\n", "utf8");
    const result = spawnSync(process.execPath, [cliPath, "check", directory], { encoding: "utf8", timeout: 120_000 });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stdout + result.stderr,
      /VEL6002: 'left-pad' is a JavaScript package, not a VelarScript package; reach it across the bridge — import js \{name\} from "left-pad", and declare 'extern module "left-pad":' when you want the contract checked/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[MOD-U7] a package that is not installed at all keeps its own answer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-z1-missing-"));
  try {
    await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel" }), "utf8");
    await writeFile(join(directory, "main.vel"), "import {pad} from \"nowhere-package\"\n\nprint(pad(\"a\"))\n", "utf8");
    const result = spawnSync(process.execPath, [cliPath, "check", directory], { encoding: "utf8", timeout: 120_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /is not installed/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// BRG-D2 (D38 rule 47): an extern member never degrades silently.
// ---------------------------------------------------------------------------

test("[BRG-D2] an untyped extern parameter is diagnosed at the declaration", () => {
  // It used to be accepted as `unknown`, so `render(12345)` compiled clean and
  // the escape hatch lost air with no diagnostic anywhere.
  assert.deepEqual(messages(`
extern module "some-pkg":
    export def render(source) -> string

import js {render} from "some-pkg"

def go() -> string:
    return render(12345)
`.trimStart()), [
    "Extern parameter 'source' requires an explicit type; there is no body to infer from",
  ]);
});

test("[BRG-D2] the other members of the same extern module are unaffected", () => {
  assert.deepEqual(messages(`
extern module "some-pkg":
    export def render(source) -> string
    export def encode(value: number) -> string
    export const version: string

import js {encode, version} from "some-pkg"

def go() -> string:
    return encode(1) + version
`.trimStart()), [
    "Extern parameter 'source' requires an explicit type; there is no body to infer from",
  ]);
});

test("[BRG-D2] extern class methods and constructors carry the same rule", () => {
  assert.deepEqual(messages(`
extern module "some-pkg":
    export class Widget:
        constructor(options)
        def draw(target) -> string
`.trimStart()), [
    "Extern parameter 'options' requires an explicit type; there is no body to infer from",
    "Extern parameter 'target' requires an explicit type; there is no body to infer from",
  ]);
});

test("[BRG-D2] an extern declaration with a body says why it cannot have one", () => {
  assert.deepEqual(messages(`
extern module "some-pkg":
    export def render(source: string) -> string:
        return source

    export def encode(value: number) -> string
`.trimStart()), [
    "Extern declarations have no body; the JavaScript package provides it",
  ]);
});

test("[BRG-D2] a brace-delimited body is the same mistake and gets the same answer", () => {
  // The TypeScript-declaration habit, and D38's third recovery case: the
  // member is skipped and the members after it still parse.
  assert.deepEqual(messages(`
extern module "some-pkg":
    export def render(source: string) -> string {
        return source
    }

    export def encode(value: number) -> string
`.trimStart()), [
    "Extern declarations have no body; the JavaScript package provides it",
  ]);
});

test("[BRG-D2] a fully typed extern module still compiles clean", () => {
  assert.deepEqual(messages(`
extern module "some-pkg":
    export def render(source: string) -> string

import js {render} from "some-pkg"

def go() -> string:
    return render("a")
`.trimStart()), []);
});

// ---------------------------------------------------------------------------
// The documentation items whose contract is behavior worth pinning.
// ---------------------------------------------------------------------------

test("[CLS-U3] an override signature is invariant, result type included", () => {
  // D45 rule 76: kept strict on purpose, and charter section 10 now says so.
  assert.deepEqual(messages(`
class Base:
    def read() -> number?:
        return null

class Derived extends Base:
    override def read() -> number:
        return 1
`.trimStart()), ["Override 'read' must keep the base method signature () -> number?"]);
  // Parameter names are the override's own.
  assert.deepEqual(messages(`
class Base:
    def take(value: number):
        return null

class Derived extends Base:
    override def take(amount: number):
        return null
`.trimStart()), []);
});

test("[CLS-U8] the injected field-read guard raises, and it raises a host TypeError", () => {
  const missingSource = Buffer.from("export const missing = undefined", "utf8").toString("base64");
  assert.equal(run(`
import js unsafe {missing} from "data:text/javascript;base64,${missingSource}"

class Box:
    let value: string = missing

def read(box: Box) -> string:
    return box.value

try:
    print(read(Box()))
catch error:
    print(f"{error.name}: {error.message}")
`.trimStart()), "TypeError: Field 'value' was read before initialization or contains undefined\n");
});

test("[CLS-U9] a class field may be named `self`", () => {
  assert.equal(run(`
class Node:
    let self: number = 7

    def read() -> number:
        return self.self

print(str(Node().read()))
`.trimStart()), "7\n");
});

test("[RDO-1] a value validated out of an unknown aliases what the readonly view protected", () => {
  // D47 rule 85: this is documented, not diagnosed — `unknown` is where the
  // static promise ends, and the validated value is a fresh assertion over the
  // same object. Charter sections 5 and 12 now say so.
  assert.equal(run(`
type Holder:
    payload: unknown

type Named:
    name: string

def leak(holder: readonly Holder) -> Named:
    return Named.parse(holder.payload)

const holder: Holder = {payload: {name: "original"}}
const escaped = leak(holder)
escaped.name = "mutated"
print(Json.stringify(holder.payload))
`.trimStart()), "{\"name\":\"mutated\"}\n");
});

test("[FLW-N5] an index or Map.get read is not a fact subject; a const is", () => {
  assert.deepEqual(messages(`
def useList(values: List<string?>) -> string:
    if values[0] != null:
        return values[0]
    return "none"

def useMap(lookup: Map<string, string>) -> string:
    if lookup.get("a") != null:
        return lookup.get("a")
    return "none"
`.trimStart()), ["Cannot assign string? to string", "Cannot assign string? to string"]);
  assert.deepEqual(messages(`
def useList(values: List<string?>) -> string:
    const first = values[0]
    if first != null:
        return first
    return "none"

def useMap(lookup: Map<string, string>) -> string:
    const found = lookup.get("a")
    if found != null:
        return found
    return "none"
`.trimStart()), []);
});

test("[FLW-N8] a narrowed read rechecks per read, and a const read does not", () => {
  // The cost model charter section 5 now states: the guard is emitted at each
  // read that relies on the fact, and binding to a const removes it.
  const narrowed = compile(`
type User:
    name: string

def label(user: User?) -> string:
    if user == null:
        return "missing"
    return user.name + user.name + user.name
`.trimStart());
  assert.deepEqual(narrowed.diagnostics, []);
  assert.equal(narrowed.code!.match(/__velarNarrow\(__velarValue,/gu)?.length, 3);

  const bound = compile(`
type User:
    name: string

def label(user: User?) -> string:
    if user == null:
        return "missing"
    const present = user
    return present.name + present.name + present.name
`.trimStart());
  assert.deepEqual(bound.diagnostics, []);
  assert.equal(bound.code!.match(/__velarNarrow\(__velarValue,/gu)?.length, 1);
});
