import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleApi, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";
import type { ValueType } from "../packages/compiler/src/types.ts";
import { makeTemporaryDirectory } from "./temporary-directory.ts";

// D90 R20, the Web half.
//
// Two spellings were removed because each was a second answer to a question
// the language already answers once:
//
//   `HttpResponse.ok` was always true. `response()` throws HttpResponseError
//   for every non-2xx before an author can hold the value, so `if not r.ok:`
//   was a dead branch — and the tour taught it twice. D69's shape: a field
//   that cannot be false is a lie in the type.
//
//   `velar/realtime.socket` was a second, weaker WebSocket client standing
//   beside `velar/websocket.connect`. They disagreed about which close codes
//   are legal (1000 plus 3000-4999 against the whole 1000-4999 range), one
//   threw a bare `Error` where the other throws a typed one, and only one
//   carried binary messages. Rule 3 refuses two spellings of one idea, and
//   R14's objective standard picks the specialised module.
//
// Both removals teach their successor rather than answering "no such name":
// the response field through the analyzer, the module export through the
// language's own retired-export table.

const extensions = [velarCompilerExtension];

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code });
}

async function checkProject(source: string): Promise<{ readonly failures: readonly string[]; readonly diagnostics: readonly string[] }> {
  const directory = await makeTemporaryDirectory("velar-d90-r20-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, source.trimStart(), "utf8");
  const project = await compileProject(entry, undefined, { extensions });
  return {
    failures: project.failures.map((failure) => failure.message),
    diagnostics: project.modules.flatMap((module) => module.result.diagnostics).map((item) => `${item.code} ${item.message}`),
  };
}

/** The Web `HttpResponse`, reached the way an author reaches it: `http.get(...).response()`. */
function httpResponseType(): ValueType {
  const http = webModuleInterfaces.get("velar/http")?.exports.get("http");
  assert.equal(http?.kind, "object");
  const get = http?.kind === "object" ? http.fields.get("get") : undefined;
  assert.equal(get?.kind, "intrinsic");
  const request = get?.kind === "intrinsic" ? get.result : undefined;
  assert.equal(request?.kind, "object");
  const response = request?.kind === "object" ? request.fields.get("response") : undefined;
  assert.equal(response?.kind, "function");
  const promised = response?.kind === "function" ? response.result : undefined;
  assert.equal(promised?.kind, "promise");
  const value = promised?.kind === "promise" ? promised.value : undefined;
  assert.equal(value?.kind, "object");
  return value!;
}

// ---------------------------------------------------------------------------
// HttpResponse.ok
// ---------------------------------------------------------------------------

test("[D90 R20] the Web HTTP response publishes no 'ok'", () => {
  const response = httpResponseType();
  assert.equal(response.kind, "object");
  if (response.kind !== "object") return;
  assert.deepEqual([...response.fields.keys()].sort(), [
    "blob", "bytes", "headers", "json", "parse", "status", "statusText", "streamText", "text", "url",
  ]);
  assert.equal(response.fields.has("ok"), false);
});

test("[D90 R20] reading 'ok' teaches the HttpResponseError catch path and nothing else", async () => {
  const reported = await checkProject(`
import {http} from "velar/http"

export async def check() -> bool:
    const response = await http.get("/health").response()
    return response.ok
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, [
    "VEL5075 An HTTP response has no 'ok': a non-2xx status throws 'HttpResponseError' before 'response()' answers, so every response you can hold succeeded. Handle the failure where it is raised — 'catch failure:' then 'if failure is HttpResponseError:' — and read 'failure.status' there",
  ]);
});

test("[D90 R20] the spelling VEL5075 teaches is legal VelarScript", async () => {
  // The message's whole job is to hand the author the successor spelling, so
  // the successor has to compile. The first draft taught
  // `catch failure is HttpResponseError:` — a typed catch clause the language
  // does not have (`parseTry` reads `catch <name>:` and nothing else), so the
  // author who followed the guidance collected five parse errors. `is` narrows
  // inside the block, exactly as the charter's error section spells it.
  const reported = await checkProject(`
import {HttpResponseError, http} from "velar/http"

export async def check() -> string:
    try:
        const response = await http.get("/health").response()
        return f"{response.status}"
    catch failure:
        if failure is HttpResponseError:
            return f"{failure.status}"
        throw failure
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, []);
});

test("[D90 R20] the retired field keeps its bool type, so a condition around it reads one message", async () => {
  const reported = await checkProject(`
import {http} from "velar/http"

export async def check() -> string:
    const response = await http.get("/health").response()
    if not response.ok:
        return "failed"
    return "ok"
`);
  assert.deepEqual(reported.failures, []);
  assert.equal(reported.diagnostics.length, 1);
  assert.match(reported.diagnostics[0]!, /^VEL5075 /u);
});

test("[D90 R20] an unrelated 'ok' field is untouched", async () => {
  const reported = await checkProject(`
type Health:
    ok: bool

export def read(value: Health) -> bool:
    return value.ok
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, []);
});

test("[D90 R20] writing the retired field teaches the same migration, once", async () => {
  // The read hook cannot see this shape: the core analyzes a member assignment
  // target through its member path directly, so `response.ok = true` collected
  // "Object has no field 'ok'" — true, but not the migration. One diagnostic,
  // and it is the one that names the successor.
  const reported = await checkProject(`
import {http} from "velar/http"

export async def send() -> number:
    let response = await http.get("/health").response()
    response.ok = true
    return response.status
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, [
    "VEL5075 An HTTP response has no 'ok': a non-2xx status throws 'HttpResponseError' before 'response()' answers, so every response you can hold succeeded. Handle the failure where it is raised — 'catch failure:' then 'if failure is HttpResponseError:' — and read 'failure.status' there",
  ]);
});

test("[D90 R20] a record that merely spells the response's field names is not a response", async () => {
  // Recognising the response by its field names alone reported the retirement
  // against any ten-field record spelling them. The match is against the
  // declaration, field types included, so ten numbers are ten numbers.
  const reported = await checkProject(`
export def probe() -> string:
    const fake = {status: 1, statusText: 2, url: 3, headers: 4, json: 5, text: 6, bytes: 7, streamText: 8, blob: 9, parse: 10}
    return f"{fake.ok}"
`);
  assert.deepEqual(reported.failures, []);
  assert.equal(reported.diagnostics[0], "VEL4001 Object has no field 'ok'");
});

test("[D90 R20] a namespace named before 'ok' still reads its ordinary refusal", async () => {
  // The hook infers the receiver before the core's member path does, and that
  // path is what registers the receiver as a member-access position; inferring
  // a bare namespace name outside one turned `Json.ok` into "'Json' is a
  // namespace, not a value". A namespace has no lexical binding, so the hook
  // stands aside for one and the answer matches any other absent field.
  const reported = await checkProject(`
export def probe() -> string:
    return f"{Json.ok}"
`);
  const control = await checkProject(`
export def probe() -> string:
    return f"{Json.nope}"
`);
  assert.deepEqual(reported.failures, []);
  assert.equal(reported.diagnostics[0], "VEL4001 Object has no field 'ok'");
  assert.equal(reported.diagnostics.length, control.diagnostics.length);
});

test("[D90 R20] a class name named before 'ok' still reads its own static", async () => {
  // The namespace above is one member of a sink, not the sink: the core refuses
  // a class name outside a member-access position too (D45 rule 75), and that
  // position is registered on the way down the same path. So `Result.ok` — a
  // legal static read that has nothing to do with HTTP — was answered "a class
  // name is not a value", while the sibling `Result.fine` one line away
  // compiled clean. A class name does have a lexical binding, so the hook is
  // told about it by the binding's type rather than by its absence.
  const reported = await checkProject(`
class Result:
    static const ok: bool = true
    static const fine: bool = true

export def probe() -> bool:
    return Result.ok and Result.fine
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, []);
});

test("[D90 R20] destructuring the retired field teaches the migration too", async () => {
  // The third route to the same read. `const {ok} = response` never builds a
  // MemberExpression, so it reached neither the read hook nor the write one and
  // kept the bare "Object has no field 'ok'" — the migration closed for one
  // spelling of the sink and open for its neighbour.
  const reported = await checkProject(`
import {http} from "velar/http"

export async def probe() -> number:
    const response = await http.get("/health").response()
    const {status, ok} = response
    return status
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, [
    "VEL5075 An HTTP response has no 'ok': a non-2xx status throws 'HttpResponseError' before 'response()' answers, so every response you can hold succeeded. Handle the failure where it is raised — 'catch failure:' then 'if failure is HttpResponseError:' — and read 'failure.status' there",
  ]);
  // The binding still carries `unknown`, so a use of it reports on its own.
  // That half needs the core to hand a declared type back and R20 did not rule
  // on it; what the author gets first is the migration.
  const used = await checkProject(`
import {http} from "velar/http"

export async def probe() -> bool:
    const response = await http.get("/health").response()
    const {ok} = response
    return ok
`);
  assert.equal(used.diagnostics[0]?.startsWith("VEL5075 "), true, JSON.stringify(used.diagnostics));
  // A record that genuinely lacks the field is not a response, and keeps the
  // ordinary refusal.
  const unrelated = await checkProject(`
type Health:
    status: number

export def probe(health: Health) -> number:
    const {ok} = health
    return health.status
`);
  assert.deepEqual(unrelated.diagnostics, ["VEL4001 Object has no field 'ok'"]);
});

test("[D90 R20] a non-2xx still raises HttpResponseError at run time", () => {
  const source = standardModuleSource("velar/http", { base: "/" }, extensions) ?? "";
  const execution = executeModule(`
globalThis.fetch = async (url) => url.endsWith("/health")
  ? new Response("done", { status: 200, statusText: "OK" })
  : new Response("{\\"detail\\":\\"missing\\"}", { status: 404, statusText: "Not Found", headers: { "content-type": "application/json" } });
${source}
try {
  const response = await http.get("https://example.test/missing").response();
  console.log("accepted", Object.hasOwn(response, "ok"));
} catch (error) {
  console.log(error.name, error.status, error.body.detail);
}
const okResponse = await http.get("https://example.test/health").response();
console.log(Object.hasOwn(okResponse, "ok"), okResponse.status, await okResponse.text());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "HttpResponseError 404 missing\nfalse 200 done\n");
});

// ---------------------------------------------------------------------------
// velar/realtime.socket
// ---------------------------------------------------------------------------

test("[D90 R20] velar/realtime publishes only eventStream", () => {
  assert.deepEqual([...(webModuleInterfaces.get("velar/realtime")?.exports.keys() ?? [])], ["eventStream"]);
  assert.deepEqual(standardModuleApi(extensions).modules["velar/realtime"], ["eventStream"]);
});

test("[D90 R20] importing socket from velar/realtime names velar/websocket.connect", async () => {
  const reported = await checkProject(`
import {socket} from "velar/realtime"

export def open():
    const live = socket("wss://example.test/live", {})
    live.send("hello")
`);
  assert.deepEqual(reported.failures, [
    "Use 'connect' from \"velar/websocket\"; velar/realtime.socket is retired and connect is the one WebSocket client — 'using live = await connect(url)', then 'await live.send(text)' and 'await live.next()'. Send JSON with 'Json.stringify(value)', which needs no import",
  ]);
});

test("[D90 R20] the velar/realtime runtime carries no WebSocket client", () => {
  const source = standardModuleSource("velar/realtime", { base: "/" }, extensions) ?? "";
  assert.ok(source.length > 0);
  assert.doesNotMatch(source, /WebSocket/u);
  assert.doesNotMatch(source, /sendJson/u);
  // The strict-JSON runtime travelled with `sendJson` and nothing else in this
  // module used it, so retiring the socket takes the whole serializer out of
  // every page that opens an event stream.
  assert.doesNotMatch(source, /__velarJsonStringify/u);
  assert.match(source, /export function eventStream\(/u);
});

test("[D90 R20] velar/websocket answers everything realtime.socket did, and more", async () => {
  const reported = await checkProject(`
import {connect} from "velar/websocket"

export type Draft:
    title: string

export async def live(url: string, draft: Draft) -> string:
    using connection = await connect(url, {timeout: 5s})
    await connection.send("hello")
    await connection.send(Json.stringify(draft))
    const message = await connection.next()
    const state = connection.state()
    await connection.close(1000, "done")
    // The close-code range realtime.socket refused; velar/websocket accepts it.
    await connection.close(1001, "going away")
    if message is string:
        return f"{state}:{message}"
    return state
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, []);
});

test("[D90 R20] the surviving client carries everything realtime.socket carried, driven against a host socket", () => {
  // The consolidation's whole claim is that nothing was lost, and that claim is
  // about behaviour, not about which names type-check. Every capability
  // realtime.socket had is exercised here against a fake host WebSocket —
  // state, text send, receive, close — beside the two it refused: a binary
  // message, and close code 1001.
  const source = standardModuleSource("velar/websocket", { base: "/" }, extensions) ?? "";
  const execution = executeModule(`
const sockets = [];
globalThis.WebSocket = class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) {
    this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.binaryType = "blob";
    this.sent = []; this.closedWith = null; this.listeners = new Map();
    sockets.push(this);
    queueMicrotask(() => { this.readyState = 1; this.dispatch("open", {}); });
  }
  addEventListener(type, handler, options) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ handler, once: options?.once === true });
    this.listeners.set(type, entries);
  }
  dispatch(type, event) {
    const entries = this.listeners.get(type) ?? [];
    this.listeners.set(type, entries.filter((entry) => !entry.once));
    for (const entry of entries) entry.handler(event);
  }
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closedWith = [code ?? 1005, reason ?? ""]; this.readyState = 3; this.dispatch("close", { code, reason }); }
};
${source}
const live = await connect("wss://example.test/live");
const host = sockets[0];
console.log("state", live.state(), "binaryType", host.binaryType);
await live.send("hello");
await live.send(new Uint8Array([1, 2, 3]));
console.log("sent", JSON.stringify(host.sent[0]), host.sent[1] instanceof Uint8Array, Array.from(host.sent[1]).join("-"));
host.dispatch("message", { data: "pushed" });
console.log("next", await live.next());
await live.close(4000, "done");
console.log("closed", JSON.stringify(host.closedWith), live.state());
try { await live.send("late"); } catch (error) { console.log("late", error.name, error instanceof WebSocketClosedError); }

const second = await connect("wss://example.test/second");
const secondHost = sockets[1];
try { await second.close(5000); } catch (error) { console.log("range", error.name, error.message); }
await second.close(1001, "going away");
console.log("code1001", JSON.stringify(secondHost.closedWith));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "state open binaryType arraybuffer",
    'sent "hello" true 1-2-3',
    "next pushed",
    'closed [4000,"done"] closed',
    "late WebSocketClosedError true",
    "range RangeError WebSocket close code must be from 1000 through 4999",
    'code1001 [1001,"going away"]',
    "",
  ].join("\n"));
});

test("[D90 R20] the four typed WebSocket failures are catchable where the bare Error was not", async () => {
  const reported = await checkProject(`
import {WebSocketBackpressureError, WebSocketClosedError, WebSocketProtocolError, WebSocketTimeoutError, connect} from "velar/websocket"

export async def open(url: string) -> string:
    try:
        using connection = await connect(url)
        await connection.send("hello")
        return "sent"
    catch failure:
        if failure is WebSocketTimeoutError:
            return "timeout"
        if failure is WebSocketClosedError:
            return "closed"
        if failure is WebSocketProtocolError:
            return "protocol"
        if failure is WebSocketBackpressureError:
            return "backpressure"
        return "other"
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, []);
});
