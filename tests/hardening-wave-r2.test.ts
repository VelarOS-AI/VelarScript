import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "@velarscript/compiler";
import {
  TEXT_NAMESPACE_MEMBERS,
  VELAR_COLLECTION_LOWERING_MODULE,
  VELAR_HOST_ERROR_NAMES,
} from "@velarscript/compiler/extension";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleInterfaces, standardModuleSources } from "../packages/cli/src/standard-modules.ts";
import { LOOK_NUMERIC_TYPE_NAMES, LOOK_PUBLIC_TYPE_NAMES } from "../packages/web/src/look.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

// Every generated module names its dependencies by specifier, so the whole
// standard module graph is linked as data URLs before the program runs. Three
// passes settle the graph: each pass rewrites specifiers against the URLs the
// previous pass minted, which is enough for the two-level core dependencies.
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
  const result = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: 20_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function run(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  return execution.stdout;
}

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.message);
}

test("[D50-89] error.code is the declared class name and shares one source with .name", () => {
  const output = run(`
class TimeoutError extends Error:
    constructor(message: string):
        super(message)

def report(error: Error) -> string:
    return f"{error.code}|{error.name}"

try:
    throw TimeoutError("slow")
catch error:
    print(report(error))
try:
    throw Error("plain")
catch error:
    print(report(error))
try:
    throw ValidationError("bad")
catch error:
    print(error.code)
try:
    throw NarrowingError("stale")
catch error:
    print(error.code)
try:
    const items: List<number> = []
    print(items[4])
catch error:
    print(error.code)
`.trimStart());
  assert.equal(output, "TimeoutError|TimeoutError\nError|Error\nValidationError\nNarrowingError\nIndexError\n");

  // The projection reads the own 'name' property the class lowering writes, so
  // no host object carrying an unrelated 'code' can impersonate a class.
  const emitted = compile("try:\n    throw Error(\"x\")\ncatch error:\n    print(error.code)\n");
  assert.deepEqual(emitted.diagnostics, []);
  assert.match(emitted.code ?? "", /__velarErrorCode\(/u);
  assert.doesNotMatch(emitted.code ?? "", /__velarReadInstanceField\([^)]*"code"\)/u);
});

test("[D50-89] code crosses a module boundary because only the declaring module writes it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-r2-code-"));
  try {
    await writeFile(join(directory, "errors.vel"), `
export class PaymentError extends Error:
    constructor(message: string):
        super(message)
`.trimStart(), "utf8");
    await writeFile(join(directory, "domain.vel"), `
export type Amount:
    cents: number

export def parseAmount(raw: unknown) -> Amount:
    return Amount.parse(raw)
`.trimStart(), "utf8");
    const entry = join(directory, "main.vel");
    await writeFile(entry, `
import {PaymentError} from "./errors.vel"
import {parseAmount} from "./domain.vel"

try:
    throw PaymentError("declined")
catch error:
    print(f"{error.code}|{error.name}|{error is PaymentError}")
try:
    print(parseAmount("not a record").cents)
catch error:
    print(f"{error.code}|{error is ValidationError}")
`.trimStart(), "utf8");
    const result = spawnSync(process.execPath, [cliPath, "run", entry], { encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "PaymentError|PaymentError|true\nValidationError|true\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D50-89] a failure no Velar class declared reports the contract it does satisfy", () => {
  const output = run(`
type Port:
    value: number

try:
    print(Port.parse("not a record"))
catch error:
    print(error.code)
try:
    const text: string = "abc"
    print(text.repeat(0.0 - 1.0))
catch error:
    print(error.code)
`.trimStart());
  assert.equal(output, "ValidationError\nError\n");
});

test("[D50-89] the capability error classes are nameable, discriminable, and leaf", () => {
  const output = run(`
def recover(error: Error) -> string:
    if error is FileNotFoundError:
        return f"missing:{error.path ?? "?"}"
    if error is PermissionError:
        return "denied"
    if error is NotADirectoryError:
        return "not-a-directory"
    if error is FileExistsError:
        return "exists"
    if error is AddressInUseError:
        return "port-taken"
    return "other"

try:
    throw FileNotFoundError("gone")
catch error:
    print(f"{recover(error)} {error.code}")
try:
    throw PermissionError("no access")
catch error:
    print(f"{recover(error)} {error.code}")
try:
    throw NotADirectoryError("a file")
catch error:
    print(f"{recover(error)} {error.code}")
try:
    throw FileExistsError("already there")
catch error:
    print(f"{recover(error)} {error.code}")
try:
    throw AddressInUseError("8080 is bound")
catch error:
    print(f"{recover(error)} {error.code}")
try:
    throw Error("something else")
catch error:
    print(f"{recover(error)} {error.code}")
`.trimStart());
  assert.equal(output, [
    "missing:? FileNotFoundError",
    "denied PermissionError",
    "not-a-directory NotADirectoryError",
    "exists FileExistsError",
    "port-taken AddressInUseError",
    "other Error",
    "",
  ].join("\n"));

  for (const name of VELAR_HOST_ERROR_NAMES) {
    assert.deepEqual(messages(`class Custom extends ${name}:\n    constructor(message: string):\n        super(message)\n`), [
      `The builtin error type '${name}' cannot be extended; extend Error and declare your own fields`,
    ]);
    assert.ok(messages(`const ${name} = 1\nprint(${name})\n`).includes(`'${name}' is a reserved Core binding`), name);
  }
  // 'path' is detail on the narrowed class, never on the base contract.
  assert.deepEqual(messages("try:\n    throw FileNotFoundError(\"x\")\ncatch error:\n    print(error.path)\n"), [
    "Class 'Error' has no member 'path'",
  ]);
});

test("[D50-89] velar/fs raises the classes whose recovery differs, with the failing path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-r2-fs-"));
  try {
    await writeFile(join(directory, "file.txt"), "content", "utf8");
    const entry = join(directory, "main.vel");
    await writeFile(entry, `
import {createText, list, readText} from "velar/fs"

async def classify(task: () -> Promise<null>) -> string:
    try:
        await task()
        return "no-failure"
    catch error:
        if error is FileNotFoundError:
            return f"{error.code}:{error.path != null}"
        if error is NotADirectoryError:
            return f"{error.code}:{error.path != null}"
        if error is FileExistsError:
            return f"{error.code}:{error.path != null}"
        return f"{error.code}:unclassified"

async def main() -> null:
    const root = ${JSON.stringify(directory)}
    print(await classify(async () => print(await readText(root + "/absent.txt"))))
    print(await classify(async () => print(await list(root + "/file.txt"))))
    print(await classify(async () => await createText(root + "/file.txt", "again")))
    return null

await main()
`.trimStart(), "utf8");
    const result = spawnSync(process.execPath, [cliPath, "run", entry], { encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "FileNotFoundError:true\nNotADirectoryError:true\nFileExistsError:true\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D50-90] Text is a permanent namespace carrying the whole velar/text surface", () => {
  const output = run(`
print(Text.slug("Hello, World!"))
print(Text.title("velar standard library"))
print(Text.utf8Size("héllo"))
print(Text.chunks("abcdef", 2).join("/"))
print(Text.lineStarts("a\\nb").size)
print(Text.normalizeWhitespace("  a   b  "))
print(Text.escapeHtml("<b>"))
print(Text.matches("Velar 42", "^velar [0-9]+$", {ignoreCase: true}))
print(Text.findMatch("ticket-42", "[0-9]+")?.value ?? "none")
print(Text.splitPattern("one, two; three", " *[,;] *").join("|"))
print(Text.truncate("VelarScript", 6))
print(Text.dedent("    a"))
print(Text.indent("a", "> "))
print(Text.words("one two").join("+"))
print(Text.lines("a\\nb").join("+"))
print(Text.capitalize("ada"))
print(Text.trimStart("  a") + Text.trimEnd("b  "))
print(Text.findMatches("a1b2", "[0-9]").size)
print(Text.replaceMatches("a1b2", "[0-9]", "#"))
`.trimStart());
  assert.equal(output, [
    "hello-world",
    "Velar Standard Library",
    "6",
    "ab/cd/ef",
    "2",
    "a b",
    "&lt;b&gt;",
    "true",
    "42",
    "one|two|three",
    "Velar…",
    "a",
    "> a",
    "one+two",
    "a+b",
    "Ada",
    "ab",
    "2",
    "a#b#",
    "",
  ].join("\n"));

  const emitted = compile('print(Text.slug("a"))\n');
  assert.deepEqual(emitted.diagnostics, []);
  assert.match(emitted.code ?? "", /import \* as __velarTextNamespace from "velar\/text";/u);
  assert.match(emitted.code ?? "", /__velarTextNamespace\.slug\("a"\)/u);
});

test("[D50-90] the Text namespace covers every velar/text export and shadows lexically", () => {
  const exports_ = [...standardModuleInterfaces().get("velar/text")!.exports.keys()].sort();
  assert.deepEqual([...TEXT_NAMESPACE_MEMBERS].sort(), exports_);

  const shadowed = compile(`
const Text = {slug: (value: string) => value}
print(Text.slug("local"))
`.trimStart());
  assert.deepEqual(shadowed.diagnostics, []);
  assert.doesNotMatch(shadowed.code ?? "", /__velarTextNamespace/u);
});

test("[D50-90] Text.codePoint and Text.fromCodePoint round-trip and refuse surrogate halves", () => {
  const output = run(`
print(Text.codePoint("A"))
print(Text.codePoint("☃"))
print(Text.codePoint("🌟"))
print(Text.codePoint(""))
print(Text.codePoint("ab"))
print(Text.fromCodePoint(9731))
print(Text.fromCodePoint(127775))
try:
    print(Text.fromCodePoint(55296))
catch error:
    print(error.message)
try:
    print(Text.fromCodePoint(1114112))
catch error:
    print(error.message)
`.trimStart());
  assert.equal(output, [
    "65",
    "9731",
    "127775",
    "null",
    "null",
    "☃",
    "🌟",
    "fromCodePoint refuses surrogate halves; they are not characters on their own",
    "fromCodePoint requires a code point from 0 through 1114111",
    "",
  ].join("\n"));
});

test("[D50-90] Json is permanent in full and deepEqual is gone", () => {
  const output = run(`
type User:
    id: string

print(Json.tryParse("nope") ?? "fallback")
print(Json.tryParse("{\\"id\\": \\"a\\"}", User)?.id ?? "none")
print(Json.isSerializable({a: 1}))
print(Json.stringify({a: 1}))
print(Json.stableStringify({b: 1, a: 2}))
print(Json.clone({a: 1}).a)
print(Json.parse("{\\"id\\": \\"b\\"}", User).id)
`.trimStart());
  assert.equal(output, 'fallback\na\ntrue\n{"a":1}\n{"a":2,"b":1}\n1\nb\n');

  const interfaces = standardModuleInterfaces();
  assert.equal(interfaces.get("velar/json")!.exports.has("deepEqual"), false);
  assert.deepEqual([...interfaces.get("velar/json")!.permanentNamespace!.members].sort(),
    [...interfaces.get("velar/json")!.exports.keys()].sort());
  assert.doesNotMatch(standardModuleSources().get("velar/json")!, /deepEqual/u);
});

test("[D50-90] retired pure imports teach the namespace spelling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-r2-imports-"));
  try {
    const entry = join(directory, "main.vel");
    await writeFile(entry, `
import {slug, utf8Size} from "velar/text"
import {tryParse, deepEqual} from "velar/json"

print(slug("a") + str(utf8Size("b")) + str(tryParse("{}")) + str(deepEqual(1, 1)))
`.trimStart(), "utf8");
    const project = await compileProject(entry);
    const failures = project.failures.map((failure) => failure.message);
    for (const member of ["slug", "utf8Size"]) {
      assert.ok(failures.includes(`Use Text.${member} directly; VelarScript's pure namespaces need no import`), member);
    }
    assert.ok(failures.includes("Use Json.tryParse directly; VelarScript's pure namespaces need no import"));
    assert.ok(failures.some((message) => message.includes("velar/json") && message.includes("deepEqual")), failures.join("\n"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D50-90] equals answers every case Json.deepEqual answered, and answers them better", () => {
  const output = run(`
print(equals([0.0 / 0.0], [0.0 / 0.0]))
print(equals(0.0 - 0.0, 0.0))
print(equals(Set([[1], [2]]), Set([[2], [1]])))
print(equals(Map([[[1], "a"]]), Map([[[1], "a"]])))
print(equals({a: 1, b: 2}, {b: 2, a: 1}))
`.trimStart());
  assert.equal(output, "true\ntrue\ntrue\ntrue\ntrue\n");

  // Deep nesting past the retired comparison's 512-level budget: the retired
  // spelling answered a quiet false, and equals reports the real answer until
  // its own documented ceiling, where it throws rather than guessing.
  const urls = linkedModuleUrls();
  const probe = `
import { __velarEquals } from ${JSON.stringify(urls.get(VELAR_COLLECTION_LOWERING_MODULE)!)};
const build = (depth) => { let node = {leaf: 1}; for (let index = 0; index < depth; index += 1) node = {node}; return node; };
console.log(String(__velarEquals(build(600), build(600))));
try { __velarEquals(build(1200), build(1200)); console.log("no-throw"); }
catch (error) { console.log(error.message); }
const cycle = () => { const value = {}; value.self = value; return value; };
try { __velarEquals(cycle(), cycle()); console.log("no-throw"); }
catch (error) { console.log(error.message); }
`;
  const result = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: probe, timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, [
    "true",
    "equals cannot compare data nested more than 1000 collections deep",
    "equals cannot compare cyclic data",
    "",
  ].join("\n"));
});

test("[D50-90] capability modules never became permanent", () => {
  const interfaces = standardModuleInterfaces();
  const permanent = [...interfaces].filter(([, value]) => value.permanentNamespace).map(([name]) => name).sort();
  assert.deepEqual(permanent, ["velar/async", "velar/json", "velar/text"]);
  for (const name of ["velar/collections", "velar/math", "velar/url", "velar/time", "velar/id", "velar/log", "velar/test"]) {
    assert.equal(interfaces.get(name)?.permanentNamespace, undefined, name);
  }
});

test("[D50-92] the unreachable Opacity look type is gone", () => {
  assert.equal((LOOK_PUBLIC_TYPE_NAMES as readonly string[]).includes("Opacity"), false);
  assert.equal(LOOK_NUMERIC_TYPE_NAMES.has("Opacity"), false);
});
