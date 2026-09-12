import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { compile as compileCore } from "@velarscript/compiler";
import { type ValueType } from "../../packages/compiler/src/types.ts";
import { compileProject as compileProjectCore } from "../../packages/cli/src/project.ts";
import { standardModuleApi as standardModuleApiCore, standardModuleClosure, standardModuleDependencies, standardModuleSource as standardModuleSourceCore } from "../../packages/cli/src/standard-modules.ts";
import { standardModuleApi as languageCoreModuleApi } from "../../packages/core/src/index.ts";
import { velarNodeCompilerExtension } from "../../packages/node/src/compiler.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { webCompilerExtensions, unavailableOfficialParameterNames, compile, compileProject, standardModuleApi, standardModuleInterface, standardModuleSource } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("Core standard library combines typed ergonomics with explicit platform boundaries", async () => {
  const api = standardModuleApi();
  assert.deepEqual(Object.keys(api.modules), [
    "velar/text", "velar/math", "velar/binary", "velar/hash", "velar/validation", "velar/random", "velar/task", "velar/worker", "velar/json", "velar/async", "velar/url", "velar/time", "velar/id", "velar/log", "velar/test",
    "velar/websocket", "velar/look", "velar/app", "velar/config", "velar/web", "velar/http", "velar/storage", "velar/forms", "velar/browser", "velar/files", "velar/realtime", "velar/web-test",
  ]);
  // Text gained codePoint/fromCodePoint, velar/json retired deepEqual, and
  // velar/look retired the unreachable Opacity name; TXT-U3 then added
  // Text.normalize, D57 rule 137 retired velar/fs's Blob and readBlob — the
  // same unreachable-name judgment Opacity was deleted under — and D65 rule
  // 171 published velar/log's LogRecord, which is the record useSink already
  // handed over and had no name for. The Node server framework then added the
  // explicit json response and route-table bodyLimit operations. Concrete
  // codecs, noise, and database engines now live in independently versioned
  // source packages rather than occupying the Standard namespace. This Web
  // view intentionally excludes every Node-only module. D90 R20 then retired
  // `velar/realtime` now layers one typed reconnecting application client over
  // the sole raw WebSocket transport instead of publishing another transport.
  // `WebSocketClose` exposes the peer's real close code and reason on both
  // targets, and the typed bounded Channel contributes its type, constructor,
  // and two recovery classes to `velar/task`. D103 then added `velar/look`'s
  // `token`, the one checked spelling for a design system's CSS custom
  // property, which is why the Web half of this total is one larger. P2a-4 then
  // completed `velar/browser`'s watcher family with `watchIntersection`, the
  // only watcher whose subject is an element rather than the environment, which
  // is why it is one larger again. Web 0.12 then added the twelve checked
  // visual-filter builders used by both filter and backdropFilter.
  // D114 S3 retired `velar/collections` and its 28 exports into checked List
  // members, so the total drops by 28 and the Core prefix of this list is
  // fifteen modules rather than sixteen. Core 0.10 adds three shared validation
  // path exports and the explicit safeInteger rule.
  assert.equal(Object.values(api.modules).reduce((total, exports_) => total + exports_.length, 0), 297);
  assert.equal(Object.values(api.modules).slice(0, 15).reduce((total, exports_) => total + exports_.length, 0), 148);
  assert.equal(api.modules["velar/text"]?.length, 23);
  assert.equal(api.modules["velar/math"]?.length, 28);
  assert.deepEqual(api.modules["velar/hash"], ["sha256Text"]);
  assert.deepEqual(api.modules["velar/validation"], ["ValidationPath", "ValidationPathKind", "ValidationPathSegment", "all", "each", "field", "finite", "inspect", "integer", "nonBlank", "optional", "parse", "refine", "safeInteger", "safeParse", "validate", "validator"]);
  assert.deepEqual(api.modules["velar/json"], ["clone", "isSerializable", "parse", "stableStringify", "stringify", "tryParse"]);
  assert.deepEqual(api.modules["velar/async"], ["all", "map", "race", "retry", "series", "sleep", "timeout"]);
  assert.deepEqual(api.modules["velar/url"], ["decode", "encode", "isExternal", "join", "normalize", "parse", "parseQuery", "query", "withHash", "withQuery"]);
  assert.deepEqual(api.modules["velar/time"], ["date", "format", "iso", "monotonic", "now", "parse", "parts", "utc"]);
  assert.deepEqual(api.modules["velar/id"], ["isUuid", "uuid"]);
  assert.deepEqual(api.modules["velar/log"], ["LogRecord", "level", "log", "logger", "setLevel", "useSink"]);
  assert.deepEqual(api.modules["velar/task"], ["Cancellation", "CancellationError", "Channel", "ChannelBackpressureError", "ChannelClosedError", "Task", "TaskTimeoutError", "channel", "task", "withTimeout"]);
  for (const nodeOnly of ["velar/server-test", "velar/serve", "velar/fs", "velar/env", "velar/host", "velar/terminal", "velar/path", "velar/process"]) {
    assert.equal(api.modules[nodeOnly], undefined, `${nodeOnly} leaked into the Web Standard API`);
  }

  const directory = await makeTemporaryDirectory("velar-standard-library-");
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(entry, `
import {decode, encode, isExternal, join as joinUrl, parse as parseUrl, parseQuery, query, withHash, withQuery} from "velar/url"
import {iso, parse as parseTime, parts, utc} from "velar/time"
import {level as logLevel, log, logger, setLevel, useSink} from "velar/log"

type User:
    name: string
    role: string

const users: List<User> = [
    {name: "Ada", role: "admin"},
    {name: "Lin", role: "member"},
    {name: "Bea", role: "admin"},
]
const values = range(1, 6)
const indexed = values.map((value, index) => {index: index + 10, value})
const pairs = values.zip(["x"].repeat(5))
const grouped = users.groupBy(user => user.role)
const ordered = users.sorted(by=user => user.name)
const splitUsers = users.partition(user => user.role == "admin")
const found = users.find(user => user.name == "Lin")
const maybe: List<string?> = ["a", null, "b"]
print(values.sum())
print(indexed[0].index)
print(pairs[0].second)
print(grouped.get("admin")?.size ?? 0)
print(ordered[0].name)
print(splitUsers.rest.size)
print(found?.name ?? "missing")
print(maybe.compact().join(","))
print(values.chunk(2).flatten().size)
print([1, 1, 2].unique().size)
print(values.every(value => value > 0))

print(Text.capitalize("vELAR"))
print(Text.title("next_generation web"))
print(Text.slug("  Velar Web 游戏  "))
print(Text.truncate("VelarScript", 6))
print(Text.normalizeWhitespace("  a   b  "))
print(Text.lines("a\\nb").size)
print(Text.lineStarts("A😀\\nB\\n").map(offset => str(offset)).join(","))
print(Text.chunks("A😀游戏B", 2).join("|"))
print(Text.words("a  b").size)
print("ABC".lower())
print("abc".upper())
print("   ".trim().size == 0)
print(Text.utf8Size("A😀游戏"))
print(Text.escapeHtml("<velar>"))
print(Text.matches("Velar 42", "^velar [0-9]+$", {ignoreCase: true}))
const firstPatternMatch = Text.findMatch("ticket-42", "[0-9]+")
print(firstPatternMatch?.value ?? "missing")
print(firstPatternMatch?.index ?? -1)
print(Text.findMatch("A😀B", "B")?.index ?? -1)
const patternMatches = Text.findMatches("a1 b22", "([a-z])([0-9]+)")
print(patternMatches.size)
print(patternMatches[1].groups[1] ?? "missing")
print(Text.replaceMatches("a1 b22", "[0-9]+", "#"))
print(Text.splitPattern("a, b; c", " *[,;] *").join("|"))
print(Text.matches("first\\nlast", "^last$", {multiline: true}))
print(Text.matches("a\\nb", "^a.b$", {dotAll: true}))
const optionalPatternMatch = Text.findMatch("b", "(a)?b")
print(optionalPatternMatch?.groups?.[0] ?? "null")
print(Text.replaceMatches("x1", "[0-9]", "$&"))
print(Text.splitPattern("a1b", "([0-9])").join("|"))
// D90 R11: the options record is closed when it is written as a literal at
// this annotated parameter, so the runtime's unknown-option guard is now
// reached the only way it still can be — through a value the compiler cannot
// see every key of.
const unsupportedOptions = {sticky: true}
try:
    Text.matches("42", "[0-9]+", unsupportedOptions)
catch error:
    print(error.name)
// TX-U3 reports a *literal* broken pattern at compile time, so the runtime
// boundary is probed with a computed one — which is the only shape that can
// still reach it.
def brokenPattern() -> string:
    return "["

try:
    Text.matches("value", brokenPattern())
catch error:
    print(error.name)

print(Math.pi.toFixed(2))
print(Math.clamp(12, 0, 10))
print(Math.min(4, 2, 8))
print(Math.max(4, 2, 8))
print(Math.degrees(Math.radians(90)).round())
print(Math.gcd(18, 12))
print(Math.lcm(6, 8))

const parsed = Json.parse("{\\"name\\":\\"Nova\\",\\"role\\":\\"admin\\"}", User)
const copied = Json.clone(parsed, User)
print(copied.name)
print(Json.tryParse("bad", User)?.name ?? "fallback")
print(Json.stableStringify({z: 1, a: 2}))
print(Json.stringify([1, 2]))
print(equals(parsed, copied))
print(equals(parsed, {name: "Nova", role: "member"}))

async def double(value: number) -> number:
    return value * 2

def ready() -> number:
    return 7

const doubled = await Promise.map([1, 2, 3], double, 2)
const waited = await Promise.all([Promise.sleep(1ms), Promise.sleep(1ms)])
const retried = await Promise.retry(ready, 2)
const serial = await Promise.series([ready, ready])
await Promise.timeout(Promise.sleep(1ms), 100ms)
print(doubled[2])
print(waited.size)
print(retried)
print(serial.size)

const info = parseUrl("/items?page=1", "https://example.com/app/")
print(info.path)
print(parseQuery("?page=2").get("page") ?? "null")
print(query({page: 3}))
print(withQuery("/items", {page: 4}))
print(withHash("/items", "top"))
print(joinUrl("https://example.com", "api", "users"))
print(decode(encode("VelarScript 游戏")))
print(isExternal("https://other.example", "https://example.com"))
const timestamp = utc(2024, 1, 2, 3, 4, 5)
print(iso(timestamp))
print(parts(timestamp, "UTC").year)
print(parseTime("invalid") == null)
const stopLog = useSink(record => print(f"{record.level}:{record.scope}:{record.message}"))
setLevel("debug")
logger("core").info("ready")
log.debug("trace")
stopLog()
print(logLevel())
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  assert.equal(await readFile(join(output, "node_modules", "velar", "package.json"), "utf8").then((value) => JSON.parse(value).type), "module");
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "15", "10", "x", "2", "Ada", "1", "Lin", "a,b", "5", "2", "true",
    "Velar", "Next Generation Web", "velar-web-游戏", "Velar…", "a b", "2", "0,3,5", "A😀|游戏|B", "2", "abc", "ABC", "true", "11", "&lt;velar&gt;",
    "true", "42", "7", "2", "2", "22", "a# b#", "a|b|c", "true", "true", "null", "x$&", "a|b", "TypeError", "TypeError",
    "3.14", "10", "2", "8", "90", "6", "24",
    "Nova", "fallback", '{"a":2,"z":1}', "[1,2]", "true", "false",
    "6", "2", "7", "2",
    "/items", "2", "page=3", "/items?page=4", "/items#top", "https://example.com/api/users", "VelarScript 游戏", "true",
    "2024-01-02T03:04:05.000Z", "2024", "true", "info:core:ready", "debug::trace", "debug",
    "",
  ].join("\n"));
});

test("Core builtins and standard modules share one named-argument ABI", async () => {
  const intentionallyPositional = new Map<string, ReadonlySet<string>>([
    ["velar/math", new Set(["min", "max", "randomInt"])],
    ["velar/url", new Set(["join"])],
  ]);
  const assertNamedSurface = (type: ValueType, path: string, intentionallyUnnamed = false): void => {
    if (type.kind === "function" || type.kind === "intrinsic" || type.kind === "action") {
      if (!intentionallyUnnamed) {
        assert.equal(type.parameterNames?.length, type.parameters.length, `${path} must expose stable parameter names`);
        assert.ok(type.parameterNames?.every(Boolean), `${path} must not expose an empty parameter name`);
        for (const name of type.parameterNames ?? []) assert.ok(!unavailableOfficialParameterNames.has(name), `${path} parameter '${name}' must be writable at a call site`);
      }
      assertNamedSurface(type.result, `${path} return`);
      return;
    }
    if (type.kind === "object") {
      for (const [name, field] of type.fields) assertNamedSurface(field, `${path}.${name}`);
      return;
    }
    if (type.kind === "promise") assertNamedSurface(type.value, `${path} value`);
    if (type.kind === "optional") assertNamedSurface(type.inner, `${path} value`);
    if (type.kind === "union") for (const member of type.members) assertNamedSurface(member, `${path} member`);
  };
  for (const source of [
    "velar/text", "velar/math", "velar/binary", "velar/hash", "velar/validation", "velar/random", "velar/task", "velar/worker", "velar/websocket", "velar/json", "velar/async",
    "velar/url", "velar/time", "velar/id", "velar/log", "velar/test",
  ]) {
    for (const [name, type] of standardModuleInterface(source)!.exports) {
      assertNamedSurface(type, `${source}.${name}`, intentionallyPositional.get(source)?.has(name));
    }
  }

  const directory = await makeTemporaryDirectory("velar-named-standard-library-");
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(entry, `
import {expect} from "velar/test"

type User:
    name: string

enum Status:
    ready
    done

def markText(label: string, value: string) -> string:
    print(value=label)
    return value

def markValues(label: string, values: List<string>) -> List<string>:
    print(value=label)
    return values

def markNumber(label: string, value: number) -> number:
    print(value=label)
    return value

// D114 S3: the collection half of this ABI is a checked List member now. The
// receiver evaluates first, and the named arguments after it still evaluate in
// source order rather than in parameter order: end before start.
print(value=markValues("values", ["a", "b"]).join(separator=markText("separator", ",")))
print(value=["x", "y", "z"].slice(end=markNumber("end", 3), start=markNumber("start", 1)).size)
print(value=[10].repeat(count=1)[0])
print(value=3.14159.toFixed(digits=2))
print(value=" Velar ".trim())

const parsed = Json.parse(target=User, text="{\\\"name\\\":\\\"Ada\\\"}")
const typed = User.parse(value={name: "Lin"})
print(value=parsed.name)
print(value=typed.name)
print(value=Status.is(value=Status.ready))
print(value=number(text="12"))
print(value=str(value=12))
print(value=Error(message="boom").message)

const scores: Map<string, number> = Map()
scores.set("Ada", 9)
const copied = Map(source=scores)
const tags = Set(source=["web"])
print(value=copied.get("Ada") ?? 0)
print(value=tags.has("web"))

const doubled = await Promise.map(concurrency=2, worker=async value => value * 2, values=[1, 2])
expect(actual=doubled).toHaveLength(length=2)
print(value=doubled[1])
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, String(build.stderr));
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "values\nseparator\na,b\nend\nstart\n2\n10\n3.14\nVelar\nAda\nLin\ntrue\n12\n12\nboom\n9\ntrue\n4\n");

  const invalid = compileCore(`
print(item="wrong")
number(value="12")
Map(values=Map())
Set(values=[])
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /Unknown named argument 'item'/u);
  assert.match(messages, /Unknown named argument 'value'/u);
  assert.match(messages, /Unknown named argument 'values'/u);
});

test("local platform modules are typed Core APIs and refuse browser targets", async () => {
  const directory = await makeTemporaryDirectory("velar-local-platform-types-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {RequestBodyTooLargeError, ServeRequest, ServeResponse, fileResponse, serve} from "velar/serve"
import {exists, list, readText, writeText} from "velar/fs"
import {get, require as requireEnv} from "velar/env"
import {exit, onShutdown} from "velar/host"
import {terminal} from "velar/terminal"

async def handle(request: ServeRequest) -> ServeResponse:
    if request.path == "/health":
        return {status: 200, json: {ok: true}}
    if request.path == "/limited":
        try:
            return {status: 200, text: await request.text(maxBytes=1024)}
        catch error:
            if error is RequestBodyTooLargeError:
                return {status: 413, json: {maxBytes: error.maxBytes}}
            throw error
    return fileResponse(root="dist", path=request.path, fallback="index.html")

async def cleanup():
    return null

onShutdown(cleanup)
const arguments_: List<string> = terminal.args()
const interactive: bool = terminal.isInteractive()
const configured = get("PORT") ?? requireEnv("FALLBACK_PORT")
print(configured)
`.trimStart(), "utf8");

  const core = await compileProjectCore(entry, new Map(), { extensions: [] });
  assert.deepEqual(core.failures, []);
  assert.deepEqual(core.modules.flatMap((module) => module.result.diagnostics), []);

  const web = (await compileProject(entry)).modules.flatMap((module) => module.result.diagnostics.filter((item) => item.code === "VEL6008"));
  assert.ok(web.some((item) => item.message === "velar/serve is a local runtime module and cannot run in a web application; web applications are served by the dev server in development and by static hosting in production; call an HTTP API with velar/http"), JSON.stringify(web));
  assert.ok(web.some((item) => item.message === "velar/fs is a local runtime module and cannot run in a web application; use velar/files for files the person using the application picks or saves"), JSON.stringify(web));
  assert.ok(web.some((item) => item.message === "velar/terminal is a local runtime module and cannot run in a web application; the Web has no equivalent: a page has no terminal"), JSON.stringify(web));
});

test("Core, Web, and Node own distinct WebSocket surfaces", async () => {
  assert.equal(languageCoreModuleApi().modules["velar/websocket"], undefined);
  assert.deepEqual(standardModuleApiCore(webCompilerExtensions).modules["velar/websocket"], [
    "WebSocketBackpressureError",
    "WebSocketClose",
    "WebSocketClosedError",
    "WebSocketConnection",
    "WebSocketProtocolError",
    "WebSocketTimeoutError",
    "connect",
  ]);
  assert.deepEqual(standardModuleApiCore([velarNodeCompilerExtension]).modules["velar/websocket"], [
    "WebSocketBackpressureError",
    "WebSocketClose",
    "WebSocketClosedError",
    "WebSocketConnection",
    "WebSocketProtocolError",
    "WebSocketServer",
    "WebSocketTimeoutError",
    "connect",
    "listen",
    "run",
  ]);

  const directory = await makeTemporaryDirectory("velar-websocket-target-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, 'import {listen} from "velar/websocket"\n\nasync def open():\n    await listen({port: 0})\n', "utf8");
  const web = await compileProject(entry);
  assert.match(web.failures.map((failure) => failure.message).join("\n"), /has no export named 'listen'/u);
  const node = await compileProjectCore(entry, new Map(), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(node.failures, []);
  assert.deepEqual(node.modules.flatMap((module) => module.result.diagnostics), []);

  // D90 fr-4: `listen` and `WebSocketServer` are Node's alone, but the two
  // targets publish one `velar/websocket#type:WebSocketConnection`, so its
  // field roster cannot differ between them. A Web connection is always an
  // outbound `connect()` result, which was never upgraded from an Origin and
  // reads back null exactly as an outbound Node connection does.
  await writeFile(
    entry,
    'import {connect} from "velar/websocket"\n\nasync def open() -> string:\n    const connection = await connect("wss://example.test")\n    return connection.origin ?? "none"\n',
    "utf8",
  );
  for (const compiled of [
    await compileProject(entry),
    await compileProjectCore(entry, new Map(), { extensions: [velarNodeCompilerExtension] }),
  ]) {
    assert.deepEqual(compiled.failures, []);
    assert.deepEqual(compiled.modules.flatMap((module) => module.result.diagnostics), []);
  }
  assert.match(standardModuleSource("velar/websocket") ?? "", /value\.origin = null;/u);
});

test("local filesystem and environment modules keep their runtime boundaries bounded and opaque", async () => {
  const directory = await makeTemporaryDirectory("velar-local-platform-fs-");
  const textPath = join(directory, "note.txt");
  const invalidPath = join(directory, "invalid.txt");
  const fsRuntime = standardModuleSourceCore("velar/fs") ?? "";
  const runtimeDirectory = await makeTemporaryDirectory("velar-local-platform-runtime-");
  const runtimeRoot = join(runtimeDirectory, "node_modules", "velar");
  await mkdir(runtimeRoot, {recursive: true});
  const runtimeExports: Record<string, string> = {};
  for (const source of standardModuleClosure(["velar/fs"])) {
    if (source === "velar/fs") continue;
    const name = source.slice("velar/".length);
    const moduleSource = standardModuleSourceCore(source);
    assert.ok(moduleSource, `missing private runtime dependency ${source}`);
    runtimeExports[`./${name}`] = `./${name}.js`;
    await writeFile(join(runtimeRoot, `${name}.js`), moduleSource, "utf8");
  }
  await writeFile(join(runtimeRoot, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: runtimeExports}), "utf8");
  const fsPath = join(runtimeDirectory, "fs.mjs");
  await writeFile(fsPath, fsRuntime, "utf8");
  const fsModule = await import(`${pathToFileURL(fsPath).href}?test=${Date.now()}`) as {
    readonly exists: (path: string) => Promise<boolean>;
    readonly list: (path: string) => Promise<readonly string[]>;
    readonly readText: (path: string) => Promise<string>;
    readonly writeText: (path: string, text: string) => Promise<null>;
  };
  assert.equal(await fsModule.writeText(textPath, "Velar 本地运行时"), null);
  assert.equal(await fsModule.readText(textPath), "Velar 本地运行时");
  assert.equal(await fsModule.exists(textPath), true);
  assert.equal(await fsModule.exists(join(directory, "missing.txt")), false);
  assert.deepEqual(await fsModule.list(directory), ["note.txt"]);
  // D57 rule 137: `Blob` and `readBlob` were retired, so the runtime module the
  // build ships must stop publishing the names the dead end was reached through.
  assert.equal(Object.hasOwn(fsModule, "Blob"), false);
  assert.equal(Object.hasOwn(fsModule, "readBlob"), false);
  assert.doesNotMatch(fsRuntime, /readBlob|class Blob/u);
  await writeFile(invalidPath, Buffer.from([0xc3, 0x28]));
  await assert.rejects(fsModule.readText(invalidPath), /valid UTF-8/u);
  await assert.rejects(fsModule.readText("x".repeat(4097)), /outside the supported bounds/u);

  const envRuntime = standardModuleSourceCore("velar/env") ?? "";
  const envModule = await import(`data:text/javascript;base64,${Buffer.from(envRuntime, "utf8").toString("base64")}`) as {
    readonly get: (name: string) => string | null;
    readonly require: (name: string) => string;
  };
  const variable = `VELAR_D18_TEST_${process.pid}`;
  process.env[variable] = "ready";
  try {
    assert.equal(envModule.get(variable), "ready");
    assert.equal(envModule.require(variable), "ready");
    assert.equal(envModule.get(`${variable}_MISSING`), null);
    assert.throws(() => envModule.require(`${variable}_MISSING`), new RegExp(`${variable}_MISSING`, "u"));
    assert.throws(() => envModule.get("invalid-name"), /Environment variable names/u);
  } finally {
    delete process.env[variable];
  }
});

test("velar run serves checked responses, bounded static files, streams, and ordered shutdown", { skip: process.platform === "win32" }, async () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const directory = await makeTemporaryDirectory("velar-local-platform-run-");
  const publicRoot = join(directory, "public");
  await mkdir(publicRoot, { recursive: true });
  await writeFile(join(publicRoot, "index.html"), "<h1>Velar local platform</h1>\n", "utf8");
  await writeFile(join(publicRoot, "app.js"), "globalThis.ready = true;\n", "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "main.vel"), `
import {RequestBodyTooLargeError, ServeRequest, ServeResponse, fileResponse, serve} from "velar/serve"
import {onShutdown} from "velar/host"

type Body:
    text: string

async def chunks(write: (chunk: string) -> Promise<null>):
    await write("first")
    await Promise.sleep(40ms)
    await write("second")
    return null

async def handle(request: ServeRequest) -> ServeResponse:
    if request.path == "/api/health":
        return {status: 200, json: {ok: true}}
    if request.path == "/api/body":
        try:
            const valid = Body.parse(await request.json())
            if valid.text.size > 0:
                return {status: 200, json: {text: valid.text}}
        catch error:
            pass
        return {status: 400, json: {error: "invalid body"}}
    if request.path == "/api/limited":
        try:
            return {status: 200, text: await request.text(maxBytes=8)}
        catch error:
            if error is RequestBodyTooLargeError:
                return {status: 413, json: {maxBytes: error.maxBytes}}
            throw error
    if request.path == "/api/stream":
        return {status: 200, stream: chunks, headers: Map([["Cache-Control", "no-store"]])}
    if request.path == "/traversal":
        return fileResponse(root=${JSON.stringify(publicRoot)}, path="/../secret.txt")
    return fileResponse(root=${JSON.stringify(publicRoot)}, path=request.path, fallback="index.html")

const server = await serve(handle, port=0)

async def firstCleanup():
    print("cleanup:first")
    return null

async def stopServer():
    print("cleanup:server")
    await server.stop()
    return null

onShutdown(firstCleanup)
onShutdown(stopServer)
print(f"PORT:{str(server.port)}")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, [cli, "run"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const port = await new Promise<number>((resolvePort, rejectPort) => {
    const timer = setTimeout(() => rejectPort(new Error(`velar run did not report a port\nstdout: ${stdout}\nstderr: ${stderr}`)), 5_000);
    const inspect = () => {
      const match = /(?:^|\n)PORT:(\d+)\n/u.exec(stdout);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off("data", inspect);
      resolvePort(Number(match[1]));
    };
    child.stdout.on("data", inspect);
    inspect();
  });
  const origin = `http://127.0.0.1:${port}`;

  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const invalid = await fetch(`${origin}/api/body`, { method: "POST", body: JSON.stringify({ text: "" }) });
  assert.equal(invalid.status, 400);
  const valid = await fetch(`${origin}/api/body`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { text: "hello" });
  const nonFiniteJson = await fetch(`${origin}/api/body`, { method: "POST", body: "{\"text\":\"hello\",\"number\":1e400}" });
  assert.equal(nonFiniteJson.status, 400);

  const declaredTooLarge = await fetch(`${origin}/api/limited`, { method: "POST", body: "123456789" });
  assert.equal(declaredTooLarge.status, 413);
  assert.deepEqual(await declaredTooLarge.json(), { maxBytes: 8 });
  const chunkedTooLarge = await new Promise<{ readonly status: number; readonly body: string }>((resolveRequest, rejectRequest) => {
    import("node:http").then(({ request }) => {
      const raw = request({ host: "127.0.0.1", port, path: "/api/limited", method: "POST" }, (response) => {
        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk: string) => { body += chunk; });
        response.on("end", () => resolveRequest({ status: response.statusCode ?? 0, body }));
      });
      raw.on("error", rejectRequest);
      raw.write("12345");
      raw.end("67890");
    }, rejectRequest);
  });
  assert.equal(chunkedTooLarge.status, 413);
  assert.deepEqual(JSON.parse(chunkedTooLarge.body), { maxBytes: 8 });

  const stream = await fetch(`${origin}/api/stream`);
  const reader = stream.body!.getReader();
  const arrivals: string[] = [];
  const decoder = new TextDecoder();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    arrivals.push(decoder.decode(next.value, { stream: true }));
  }
  assert.equal(arrivals.join(""), "firstsecond");
  assert.ok(arrivals.length >= 2, JSON.stringify(arrivals));

  const script = await fetch(`${origin}/app.js`);
  assert.equal(script.status, 200);
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  const fallback = await fetch(`${origin}/nested/route`);
  assert.equal(fallback.status, 200);
  assert.match(await fallback.text(), /Velar local platform/u);
  const traversal = await fetch(`${origin}/traversal`);
  assert.equal(traversal.status, 404);

  const processTable = spawnSync("ps", ["ax", "-o", "pid=,ppid=,command="], { encoding: "utf8" });
  assert.equal(processTable.status, 0, processTable.stderr);
  const programPid = processTable.stdout.split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line))
    .find((match) => match && Number(match[2]) === child.pid && match[3]?.includes(".velar/run-") === true)?.[1];
  assert.ok(programPid, processTable.stdout);
  process.kill(Number(programPid), "SIGINT");
  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); rejectExit(new Error(`velar run did not stop\nstdout: ${stdout}\nstderr: ${stderr}`)); }, 5_000);
    child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); });
  });
  assert.equal(exitCode, 130, stderr);
  assert.match(stdout, /cleanup:first\ncleanup:server\n$/u);
});

test("every declared standard-module export exists in the shipped runtime", async () => {
  const api = standardModuleApi();
  for (const [source, expected] of Object.entries(api.modules)) {
    const runtime = standardModuleSource(source);
    assert.ok(runtime, `missing runtime source for ${source}`);
    const dependencies = standardModuleDependencies(source, { base: "/" }, webCompilerExtensions) ?? [];
    let namespace: Record<string, unknown>;
    if (dependencies.length === 0) {
      const url = `data:text/javascript;base64,${Buffer.from(runtime, "utf8").toString("base64")}`;
      namespace = await import(url) as Record<string, unknown>;
    } else {
      const directory = await mkdtemp(join(tmpdir(), "velar-standard-runtime-export-"));
      try {
        const packageRoot = join(directory, "node_modules", "velar");
        await mkdir(packageRoot, {recursive: true});
        const exports_: Record<string, string> = {};
        for (const dependency of standardModuleClosure([source], { base: "/" }, webCompilerExtensions)) {
          if (dependency === source) continue;
          const dependencySource = standardModuleSource(dependency);
          assert.ok(dependencySource, `missing runtime dependency ${dependency}`);
          const name = dependency.slice("velar/".length);
          exports_[`./${name}`] = `./${name}.js`;
          await writeFile(join(packageRoot, `${name}.js`), dependencySource, "utf8");
        }
        await writeFile(join(packageRoot, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
        const modulePath = join(directory, "runtime.mjs");
        await writeFile(modulePath, runtime, "utf8");
        namespace = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as Record<string, unknown>;
      } finally {
        await rm(directory, {recursive: true, force: true});
      }
    }
    assert.deepEqual(Object.keys(namespace).sort(), expected, `${source} type/runtime export drift`);
  }
});
