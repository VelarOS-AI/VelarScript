import assert from "node:assert/strict";
import { Buffer as NodeBuffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { compileProject } from "../../packages/cli/src/project.ts";
import { velarNodeCompilerExtension } from "../../packages/node/src/compiler.ts";
import { routePattern, runtime, type ServeCompilerBridge } from "../support/node-runtime.ts";

/**
 * D114 GA-U3 — one core case per `velar/*` module Node publishes on the
 * network side: `velar/serve`, `velar/websocket` and `velar/http`.
 *
 * The other half of the quick tier `node-platform.test.ts` opens; its header
 * says why the split exists and why it is two files. What is here is the main
 * contract of each of the three — a route that binds and normalizes its own
 * inputs, an accepted upgrade that carries its Origin, and an outbound request
 * bounded in the four ways the host owns — and what stayed in
 * `node-platform.slow.test.ts` is everything that needs a server up for
 * seconds or an intrinsic replaced under it.
 */

test("Node ServeApp routes bind checked inputs, compose, and normalize HTTP outcomes", async () => {
  const serveRuntime = await runtime<{
    readonly HttpProblem: new (options: Record<string, unknown>) => Error;
    readonly ServeApp: object;
    created(value: unknown, headers?: Map<string, string>): unknown;
    noContent(): unknown;
    prefix(path: string, app: unknown): unknown;
    bodyLimit(app: unknown, maxBytes: number): unknown;
    json(value: unknown): unknown;
    setCookie(response: unknown, name: string, value: string): unknown;
    use(app: unknown, middleware: (request: unknown, next: () => Promise<unknown>) => Promise<unknown>): unknown;
    openapi(app: unknown, title?: string, version?: string): { readonly info: { readonly title: string; readonly version: string }; readonly paths: Record<string, unknown> };
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");

  assert.equal("__velarCreateServeRoute" in serveRuntime, false);
  assert.equal("__velarCreateServeApp" in serveRuntime, false);
  assert.deepEqual(Object.keys(serveRuntime.ServeApp).sort(), ["is", "parse"]);
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createPattern(source: Record<string, unknown>): unknown;
    createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>, metadata?: Record<string, unknown>): unknown;
    createWebSocket(path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>, metadata?: Record<string, unknown>): unknown;
    createApp(name: string, items: readonly unknown[]): unknown;
  } | undefined;
  assert.ok(bridge);
  assert.equal(Object.isFrozen(bridge), true);
  const health = bridge.createRoute("GET", routePattern(bridge, "/health"), [], async () => ({ok: true}), {operationId: "health"});
  const realtime = bridge.createWebSocket(
    routePattern(bridge, "/worlds/{worldId:string}/realtime"),
    [{name: "connection", source: "connection", kind: "connection", required: true}],
    async () => null,
    {operationId: "worldRealtime", summary: "Realtime world session"},
  );
  const cookies = bridge.createRoute("GET", routePattern(bridge, "/cookies"), [], async () => serveRuntime.setCookie(serveRuntime.setCookie(serveRuntime.json({ok: true}), "first", "1"), "second", "2"));
  // p"" 的查询契约只描述单值参数；重复值属于低层 HTTP 语义，显式通过 Request.queryAll 读取。
  const tags = bridge.createRoute("GET", routePattern(bridge, "/tags"), [
    {name: "request", source: "request", kind: "request", required: true, check: null},
  ], async (_path: unknown, request: {queryAll: Map<string, readonly string[]>}) => ({tag: request.queryAll.get("tag") ?? []}));
  const user = bridge.createRoute(
    "GET",
    routePattern(bridge, "/users/{id:number}", [{name: "details", kind: "bool", optional: true}]),
    [],
    async (path: {params: {id: number}; query: {details?: boolean}}) => ({id: path.params.id, details: path.query.details ?? false}),
    {responseSchema: {type: "object"}},
  );
  const create = bridge.createRoute("POST", routePattern(bridge, "/users"), [
    {name: "input", source: "body", kind: "data", required: true, check: (value: unknown) => !!value && typeof value === "object" && typeof (value as {name?: unknown}).name === "string", schema: {type: "object", properties: {name: {type: "string"}}, required: ["name"]}},
  ], async (_path: unknown, input: unknown) => serveRuntime.created(input));
  const missing = bridge.createRoute("GET", routePattern(bridge, "/missing"), [], async () => {
    throw new serveRuntime.HttpProblem({status: 404, reason: "user.not_found", title: "User not found", headers: new Map([["x-error", "missing"]])});
  });
  const empty = bridge.createRoute("DELETE", routePattern(bridge, "/users/{id:number}"), [], async () => serveRuntime.noContent());
  const users = bridge.createApp("users", [user, create, missing, empty]);
  let userMiddlewareCalls = 0;
  const protectedUsers = serveRuntime.use(users, async (_request, next) => {
    userMiddlewareCalls += 1;
    return next();
  });
  const limitedCreate = bridge.createRoute("POST", routePattern(bridge, "/"), [
    {name: "input", source: "body", kind: "data", required: true, check: () => true},
  ], async (_path: unknown, input: unknown) => input);
  const limited = serveRuntime.bodyLimit(bridge.createApp("limited", [limitedCreate]), 8);
  const doubleNextRoute = bridge.createRoute("GET", routePattern(bridge, "/double-next"), [], async () => ({ok: true}));
  const recoveredDoubleNext = serveRuntime.use(bridge.createApp("double-next", [doubleNextRoute]), async (_request, next) => {
    try { return await next(); }
    catch { return {status: 500, json: {error: "middleware_failed"}}; }
  });
  const doubleNext = serveRuntime.use(recoveredDoubleNext, async (_request, next) => {
    await next();
    return next();
  });
  const app = bridge.createApp("api", [
    health,
    cookies,
    tags,
    serveRuntime.prefix("/api", protectedUsers),
    serveRuntime.prefix("/limited", limited),
    doubleNext,
    realtime,
  ]);
  const document = serveRuntime.openapi(app, "Users API", "2.0.0");
  assert.deepEqual(document.info, {title: "Users API", version: "2.0.0"});
  assert.deepEqual(Object.keys(document.paths).sort(), ["/api/missing", "/api/users", "/api/users/{id}", "/cookies", "/double-next", "/health", "/limited", "/tags", "/worlds/{worldId}/realtime"]);
  assert.equal((document.paths["/health"] as {get: {operationId: string}}).get.operationId, "health");
  assert.deepEqual(JSON.parse(JSON.stringify((document.paths["/worlds/{worldId}/realtime"] as {get: unknown}).get)), {
    operationId: "worldRealtime",
    parameters: [{name: "worldId", in: "path", required: true, schema: {type: "string"}}],
    responses: {"101": {description: "Switching Protocols"}},
    "x-velar-transport": "websocket",
    summary: "Realtime world session",
  });
  assert.deepEqual(JSON.parse(JSON.stringify((document.paths["/tags"] as {get: {parameters: unknown[]}}).get.parameters)), []);
  assert.deepEqual(JSON.parse(JSON.stringify((document.paths["/api/users/{id}"] as {get: {parameters: unknown[]}}).get.parameters)), [
    {name: "id", in: "path", required: true, schema: {type: "number"}},
    {name: "details", in: "query", required: false, schema: {type: "boolean"}},
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify((document.paths["/api/users"] as {post: {requestBody: {content: {"application/json": {schema: unknown}}}}}).post.requestBody.content["application/json"].schema)),
    {type: "object", properties: {name: {type: "string"}}, required: ["name"]},
  );

  const server = await serveRuntime.serve(app, 0);
  try {
    const healthy = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), {ok: true});
    assert.equal(userMiddlewareCalls, 0, "middleware from a composed app must remain scoped to that app's routes");
    const cookieResponse = await fetch(`http://127.0.0.1:${server.port}/cookies`);
    assert.deepEqual(cookieResponse.headers.getSetCookie().map((value) => value.split(";", 1)[0]), ["first=1", "second=2"]);

    const detailed = await fetch(`http://127.0.0.1:${server.port}/api/users/42?details=true`);
    assert.equal(detailed.status, 200);
    assert.deepEqual(await detailed.json(), {id: 42, details: true});
    assert.equal(userMiddlewareCalls, 1);
    const defaulted = await fetch(`http://127.0.0.1:${server.port}/api/users/7`);
    assert.deepEqual(await defaulted.json(), {id: 7, details: false});
    const invalidPath = await fetch(`http://127.0.0.1:${server.port}/api/users/not-a-number`);
    assert.equal(invalidPath.status, 422);
    const invalidPathProblem = await invalidPath.json() as {code: string; parameter: string};
    assert.equal(invalidPathProblem.code, "request.invalid.request");
    assert.equal(invalidPathProblem.parameter, "id");
    for (const invalidNumber of ["%2042", "0x2a"]) {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/users/${invalidNumber}`);
      assert.equal(response.status, 422);
    }
    const duplicateScalar = await fetch(`http://127.0.0.1:${server.port}/api/users/42?details=true&details=false`);
    assert.equal(duplicateScalar.status, 422);
    const duplicateProblem = await duplicateScalar.json() as {code: string; parameter: string};
    assert.equal(duplicateProblem.code, "request.duplicate.parameter");
    assert.equal(duplicateProblem.parameter, "details");
    const repeatedList = await fetch(`http://127.0.0.1:${server.port}/tags?tag=one&tag=two`);
    assert.deepEqual(await repeatedList.json(), {tag: ["one", "two"]});
    const encodedSeparator = await fetch(`http://127.0.0.1:${server.port}/api/users/4%2F2`);
    assert.equal(encodedSeparator.status, 400, "encoded path separators are rejected before routing");
    const invalidQueryEncoding = await fetch(`http://127.0.0.1:${server.port}/health?value=%FF`);
    assert.equal(invalidQueryEncoding.status, 400, "invalid query UTF-8 is rejected instead of being replaced silently");

    const created = await fetch(`http://127.0.0.1:${server.port}/api/users`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({name: "Ada"})});
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), {name: "Ada"});
    const invalidBody = await fetch(`http://127.0.0.1:${server.port}/api/users`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({name: 1})});
    assert.equal(invalidBody.status, 422);
    const invalidJson = await fetch(`http://127.0.0.1:${server.port}/api/users`, {method: "POST", headers: {"content-type": "application/json"}, body: "{"});
    assert.equal(invalidJson.status, 400);
    const unsupported = await fetch(`http://127.0.0.1:${server.port}/api/users`, {method: "POST", headers: {"content-type": "text/plain"}, body: JSON.stringify({name: "Ada"})});
    assert.equal(unsupported.status, 415);
    const limitedBody = await fetch(`http://127.0.0.1:${server.port}/limited`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({value: 1})});
    assert.equal(limitedBody.status, 413);

    const notFound = await fetch(`http://127.0.0.1:${server.port}/api/missing`);
    assert.equal(notFound.status, 404);
    assert.equal(((await notFound.json()) as {code: string}).code, "user.not_found");
    assert.equal(notFound.headers.get("x-error"), "missing");
    const deleted = await fetch(`http://127.0.0.1:${server.port}/api/users/42`, {method: "DELETE"});
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), "");
    assert.equal(deleted.headers.get("content-type"), null);
    const head = await fetch(`http://127.0.0.1:${server.port}/health`, {method: "HEAD"});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const middlewareBeforeOptions = userMiddlewareCalls;
    const options = await fetch(`http://127.0.0.1:${server.port}/api/users/42`, {method: "OPTIONS"});
    assert.equal(options.status, 204);
    assert.equal(userMiddlewareCalls, middlewareBeforeOptions + 1);
    const method = await fetch(`http://127.0.0.1:${server.port}/health`, {method: "POST"});
    assert.equal(method.status, 405);
    assert.match(method.headers.get("allow") ?? "", /GET/u);
    assert.match(method.headers.get("allow") ?? "", /HEAD/u);
    assert.match(method.headers.get("allow") ?? "", /OPTIONS/u);
    const repeatedNext = await fetch(`http://127.0.0.1:${server.port}/double-next`);
    assert.equal(repeatedNext.status, 500);
  } finally {
    await server.stop();
  }
});

test("an accepted WebSocket connection exposes the upgrade Origin as string?", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-websocket-origin-"));
  try {
    const entry = join(directory, "main.vel");
    const source = `
import {listen} from "velar/websocket"

async def start():
    const server = await listen({port: 0, origins: ["https://client.test"]})
    const connection = await server.next()
    if connection != null:
        const origin: REQUIRED = connection.origin
        if origin != null:
            print(origin)
    return null
`.trimStart();
    await writeFile(entry, source.replace("REQUIRED", "string?"), "utf8");
    const accepted = await compileProject(entry, new Map(), {extensions: [velarNodeCompilerExtension]});
    assert.deepEqual(accepted.failures, []);
    assert.deepEqual(accepted.modules.flatMap((module) => module.result.diagnostics), []);
    const acceptedCode = accepted.modules[0]?.result.code ?? "";
    assert.match(acceptedCode, /const origin = \(connection\.origin \?\? null\)/u);
    assert.doesNotMatch(acceptedCode, /__velarNarrow/u,
      "a const copy returned by next keeps its non-null existence fact without revalidating the mutable connection object");

    await writeFile(entry, source.replace("REQUIRED", "string"), "utf8");
    const refused = await compileProject(entry, new Map(), {extensions: [velarNodeCompilerExtension]});
    assert.equal(
      refused.modules.flatMap((module) => module.result.diagnostics)[0]?.message,
      "Cannot assign string? to string",
      "the Origin is absent whenever the client sent none, so it cannot be read as string",
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Node HTTP bounds isolated host metadata, UTF-8, declared lengths, and response chunks", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/headers") {
      for (let index = 0; index < 101; index += 1) response.setHeader(`x-velar-${index}`, "value");
      response.end("headers");
      return;
    }
    if (request.url === "/empty") {
      response.writeHead(204, {"content-length": "100"});
      response.end();
      return;
    }
    if (request.url === "/declared") {
      response.writeHead(200, {"content-length": "100"});
      response.end("x");
      return;
    }
    if (request.url === "/invalid-utf8") {
      response.writeHead(200, {"content-type": "text/plain"});
      response.end(NodeBuffer.from([0xff]));
      return;
    }
    if (request.url === "/chunks") {
      response.writeHead(200, {"content-type": "text/plain", "transfer-encoding": "chunked"});
      let chunk = 0;
      const writeChunk = (): void => {
        if (chunk === 4) { response.end(); return; }
        response.write(String(chunk));
        chunk += 1;
        setTimeout(writeChunk, 5);
      };
      writeChunk();
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  let http: {
    HttpResponseError: new (message: unknown, status: unknown, url: unknown) => Error;
    http: {
      get(url: string, options?: Record<string, unknown>): {
        text(): Promise<string>;
        response(): Promise<{ text(): Promise<string>; streamText(consumer: (chunk: string) => Promise<null>): Promise<null> }>;
      };
    };
  };
  http = await runtime<typeof http>("velar/http", (source) => source, (name, source) => name === "velar/node-host-v1"
    ? source.replace("const maxHttpResponseChunks = 1000000;", "const maxHttpResponseChunks = 3;")
    : source);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    await assert.rejects(http.http.get(`${base}/headers`).response(), /cannot exceed 100 fields/u);

    const empty = await http.http.get(`${base}/empty`, { timeout: 1000 }).response();
    assert.equal(await empty.text(), "");

    const declared = await http.http.get(`${base}/declared`, { maxBytes: 4 }).response();
    await assert.rejects(declared.streamText(async () => null), /exceeds maxBytes/u);

    const captured = await http.http.get(`${base}/declared`, { maxBytes: 4 }).response();
    const originalTest = RegExp.prototype.test;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalApply = Reflect.apply;
    let capturedError: unknown = null;
    try {
      RegExp.prototype.test = () => false;
      String.prototype.charCodeAt = () => 0;
      Reflect.apply = () => 0;
      try { await captured.text(); } catch (error) { capturedError = error; }
    } finally {
      RegExp.prototype.test = originalTest;
      String.prototype.charCodeAt = originalCharCodeAt;
      Reflect.apply = originalApply;
    }
    assert.ok(capturedError instanceof RangeError && /exceeds maxBytes/u.test(capturedError.message));

    await assert.rejects(http.http.get(`${base}/invalid-utf8`).text(), TypeError);
    const chunked = await http.http.get(`${base}/chunks`).response();
    await assert.rejects(chunked.streamText(async () => null), /cannot exceed 1000000 chunks/u);

    assert.throws(() => new http.HttpResponseError("message", 99, "https://example.test/"), /100 through 599/u);
    assert.throws(() => new http.HttpResponseError("x".repeat(65537), 400, "https://example.test/"), RangeError);
    assert.throws(() => new http.HttpResponseError("message", 400, "x".repeat(2 * 1024 * 1024 + 1)), RangeError);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});
