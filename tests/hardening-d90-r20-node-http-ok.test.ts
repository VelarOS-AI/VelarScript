import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { nodeModuleDependencies, nodeModuleInterfaces, nodeModuleSources, velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import type { ValueType } from "../packages/compiler/src/types.ts";

// D90 R20, the Node half.
//
// `HttpResponse.ok` was always true on this target for exactly the reason it
// was always true on Web: `response()` throws `HttpResponseError` for every
// non-2xx before an author can hold the value, so `if not r.ok:` was a dead
// branch and the field was a lie in the type. R20 says "remove it", not
// "remove Web's", so the field is gone here too, and the throw now reads the
// transport snapshot instead of the author-visible object. D90 R22 removed the
// migration teaching that briefly stood beside it: no version of this language
// was ever published, so a read of `ok` is an ordinary absent field.
//
// The wire-level `ok` stays: `hostResponse` rejects host metadata whose `ok`
// contradicts its `status`, which is an integrity check, not a lie.

const extensions = [velarNodeCompilerExtension];

async function checkProject(source: string): Promise<{ readonly failures: readonly string[]; readonly diagnostics: readonly string[] }> {
  const directory = await mkdtemp(join(tmpdir(), "velar-d90-r20-node-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, source.trimStart(), "utf8");
  const project = await compileProject(entry, new Map(), { extensions });
  return {
    failures: project.failures.map((failure) => failure.message),
    diagnostics: project.modules.flatMap((module) => module.result.diagnostics).map((item) => `${item.code} ${item.message}`),
  };
}

/** The Node `HttpResponse`, reached the way an author reaches it: `http.get(...).response()`. */
function httpResponseType(): ValueType {
  const http = nodeModuleInterfaces.get("velar/http")?.exports.get("http");
  assert.equal(http?.kind, "object");
  const get = http?.kind === "object" ? http.fields.get("get") : undefined;
  assert.equal(get?.kind, "function");
  const request = get?.kind === "function" ? get.result : undefined;
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
// The type
// ---------------------------------------------------------------------------

test("[D90 R20] the Node HTTP response type has no 'ok'", () => {
  const response = httpResponseType();
  assert.equal(response.kind, "object");
  if (response.kind !== "object") return;
  assert.deepEqual([...response.fields.keys()].sort(), [
    "bytes", "headers", "json", "parse", "status", "statusText", "streamText", "text", "url",
  ]);
  assert.equal(response.fields.has("ok"), false);
});

// ---------------------------------------------------------------------------
// The diagnostic
// ---------------------------------------------------------------------------

test("[D90 R22] reading 'ok' on a Node response is an ordinary absent field", async () => {
  const reported = await checkProject(`
import {http} from "velar/http"

export async def check() -> bool:
    const response = await http.get("/health").response()
    return response.ok
`);
  assert.deepEqual(reported.failures, []);
  // The read answers `unknown`, so the return position reports on its own; the
  // first message is the true and complete answer about `ok`.
  assert.equal(reported.diagnostics[0], "VEL4001 Object has no field 'ok'");
});

test("[D90 R22] assigning 'ok' on a Node response reads the ordinary refusal once", async () => {
  const reported = await checkProject(`
import {http} from "velar/http"

export async def check() -> bool:
    const response = await http.get("/health").response()
    response.ok = true
    return true
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, ["VEL4001 Object has no field 'ok'"]);
});

test("[D90 R22] a condition around the absent Node field reads the ordinary refusal first", async () => {
  const reported = await checkProject(`
import {http} from "velar/http"

export async def check() -> string:
    const response = await http.get("/health").response()
    if not response.ok:
        return "failed"
    return "ok"
`);
  assert.deepEqual(reported.failures, []);
  assert.equal(reported.diagnostics[0], "VEL4001 Object has no field 'ok'");
});

test("[D90 R20] an unrelated 'ok' field is untouched on the Node target", async () => {
  const reported = await checkProject(`
type Health:
    ok: bool

export def read(value: Health) -> bool:
    return value.ok
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, []);
});

test("[D90 R20] a namespace and a class name before 'ok' keep their own answers", async () => {
  // A permanent namespace (D51 rule 106) and a class name (D45 rule 75) are
  // both refused outside a member-access position, so `Json.ok` and the
  // ordinary static `Result.ok` must each keep their own answer.
  const namespaced = await checkProject(`
export def probe() -> string:
    return f"{Json.ok}"
`);
  assert.deepEqual(namespaced.failures, []);
  assert.equal(namespaced.diagnostics[0], "VEL4001 Object has no field 'ok'");
  const classStatic = await checkProject(`
class Result:
    static const ok: bool = true
    static const fine: bool = true

export def probe() -> bool:
    return Result.ok and Result.fine
`);
  assert.deepEqual(classStatic.failures, []);
  assert.deepEqual(classStatic.diagnostics, []);
});

test("[D90 R22] destructuring the absent field reads the ordinary refusal on Node too", async () => {
  const reported = await checkProject(`
import {http} from "velar/http"

export async def probe(url: string) -> number:
    const response = await http.get(url).response()
    const {status, ok} = response
    return status
`);
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(reported.diagnostics, ["VEL4001 Object has no field 'ok'"]);
  const unrelated = await checkProject(`
type Health:
    status: number

export def probe(health: Health) -> number:
    const {ok} = health
    return health.status
`);
  assert.deepEqual(unrelated.diagnostics, ["VEL4001 Object has no field 'ok'"]);
});

test("[D90 R20] the catch path a Node response's failure travels is legal VelarScript", async () => {
  // A non-2xx throws before `response()` answers, so the failure is handled
  // where it is raised: `catch <name>:` and then `is` to narrow.
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

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

async function materializeNodeRuntimeDependencies(directory: string, source: string): Promise<void> {
  const dependencies = new Set<string>();
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit(source);
  if (dependencies.size === 0) return;
  const root = join(directory, "node_modules", "velar");
  await mkdir(root, { recursive: true });
  const exports_: Record<string, string> = {};
  for (const dependency of dependencies) {
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource, `missing Node runtime dependency ${dependency}`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), moduleSource, "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "velar", private: true, type: "module", exports: exports_ }), "utf8");
}

async function runtime<T>(name: string): Promise<T> {
  const source = nodeModuleSources.get(name);
  assert.ok(source, `${name} must have a Node runtime source`);
  const directory = await mkdtemp(join(tmpdir(), "velar-node-runtime-"));
  await materializeNodeRuntimeDependencies(directory, name);
  const path = join(directory, `${name.slice("velar/".length)}.mjs`);
  await writeFile(path, source, "utf8");
  const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as T;
  await rm(directory, { recursive: true, force: true });
  return module;
}

interface HttpModule {
  readonly http: {
    get(url: string, options?: Record<string, unknown>): {
      response(): Promise<Record<string, unknown>>;
      text(): Promise<string>;
    };
  };
  readonly HttpResponseError: new (...args: never[]) => Error;
}

test("[D90 R20] a Node response object carries no 'ok' and a non-2xx still throws HttpResponseError", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/found") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("here");
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "missing" }));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const module = await runtime<HttpModule>("velar/http");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;

    const response = await module.http.get(`${base}/found`).response();
    assert.equal("ok" in response, false, "the author-visible response must not publish the retired field");
    assert.equal(response.status, 200);
    assert.equal(await (response as unknown as { text(): Promise<string> }).text(), "here");

    // The 2xx question is still asked, just against the transport snapshot.
    let raised: unknown = null;
    try {
      await module.http.get(`${base}/gone`).response();
    } catch (error) {
      raised = error;
    }
    assert.ok(raised instanceof module.HttpResponseError, `a 404 must raise HttpResponseError, received ${String(raised)}`);
    const failure = raised as Error & { status: number; url: string; body: unknown };
    assert.equal(failure.status, 404);
    assert.equal(failure.url, `${base}/gone`);
    // The parsed body arrives on a null-prototype record, so its one field is
    // what the assertion reads.
    assert.deepEqual({ ...failure.body as Record<string, unknown> }, { error: "missing" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

test("[D90 R20] the emitted velar/http source stops assigning 'ok' but keeps the host metadata check", () => {
  const source = nodeModuleSources.get("velar/http");
  assert.ok(source, "velar/http must have a Node runtime source");
  assert.equal(source.includes("this.ok = response.ok;"), false, "the author-visible response must not carry the retired field");
  assert.match(source, /if \(!response\.ok\) \{/u, "the 2xx question is asked against the transport snapshot");
  // `hostResponse` rejects a host that reports an `ok` contradicting its
  // status. That is an integrity check on the wire shape, not a field an
  // author can read, so R20 leaves it standing.
  assert.match(source, /value\.ok !== \(value\.status >= 200 && value\.status <= 299\)/u);
});
