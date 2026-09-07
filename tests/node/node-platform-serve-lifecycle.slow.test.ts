import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { routePattern, runtime } from "../support/node-runtime.ts";
import { registerRuntimeType } from "../support/runtime-type-registry.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is the lifetime of a `velar/serve` application: the in-process
 * test client that opens and closes one, the hook pairs a failed start must
 * unwind, the shutdown that joins its concurrent callers, the timeout
 * ownership a middleware cannot take away, and the starts, stops and
 * cancellations that arrive at once.
 */

test("Node server-test client runs in process with lifespan, cookies, and dependency overrides", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-server-test-files-"));
  await writeFile(join(directory, "asset.txt"), "file-body", "utf8");
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly input: {cookie(name?: string, fallback?: string | null): unknown; dependency(provider: unknown): unknown; form(type: object): unknown; upload(name?: string, maxBytes?: number): unknown};
    provide(inputs: Record<string, unknown>, resolve: (values: Record<string, unknown>) => unknown, scope?: string): unknown;
    lifecycle(app: unknown, startup: () => unknown, shutdown: () => unknown): unknown;
    setCookie(response: unknown, name: string, value: string): unknown;
    json(value: unknown): unknown;
    fileResponse(root: string, path: string): unknown;
  }>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createPattern(source: Record<string, unknown>): unknown;
    createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
    createApp(name: string, items: readonly unknown[]): unknown;
    testClient(app: unknown, overrides?: Map<unknown, unknown>): Promise<{
      get(path: string): Promise<{status: number; text(): Promise<string>; json(): Promise<unknown>}>;
      post(path: string, options?: Record<string, unknown>): Promise<{status: number; text(): Promise<string>; json(): Promise<unknown>}>;
      close(): Promise<null>;
    }>;
  };
  let starts = 0;
  let stops = 0;
  let realResolves = 0;
  const user = serveRuntime.provide({}, async () => { realResolves += 1; return {id: "real"}; }, "app");
  const login = bridge.createRoute("GET", routePattern(bridge, "/login"), [], async () => serveRuntime.setCookie(serveRuntime.setCookie(serveRuntime.json({ok: true}), "session", "s1"), "theme", "dark"));
  const me = bridge.createRoute("GET", routePattern(bridge, "/me"), [
    {name: "user", source: "dependency", kind: "dependency", required: true, check: () => true, input: serveRuntime.input.dependency(user)},
    {name: "session", source: "cookie", kind: "string", required: true, check: () => true, input: serveRuntime.input.cookie("session", null)},
    {name: "theme", source: "cookie", kind: "string", required: true, check: () => true, input: serveRuntime.input.cookie("theme", null)},
  ], async (_path: unknown, current: {id: string}, session: string | null, theme: string | null) => ({id: current.id, session, theme}));
  const Metadata = registerRuntimeType(Object.freeze({is(value: unknown) { return !!value && typeof value === "object"; }, parse(value: unknown) { return value as {title: string}; }}));
  const upload = bridge.createRoute("POST", routePattern(bridge, "/upload"), [
    {name: "metadata", source: "form", kind: "data", required: true, check: () => true, schema: {type: "object", properties: {title: {type: "string"}}, required: ["title"]}, input: serveRuntime.input.form(Metadata)},
    {name: "image", source: "upload", kind: "upload", required: true, check: () => true, input: serveRuntime.input.upload("image", 64)},
  ], async (_path: unknown, metadata: {title: string}, image: {filename: string; text(): Promise<string>}) => ({title: metadata.title, filename: image.filename, body: await image.text()}));
  const asset = bridge.createRoute("GET", routePattern(bridge, "/asset"), [], async () => serveRuntime.fileResponse(directory, "/asset.txt"));
  const app = serveRuntime.lifecycle(bridge.createApp("test", [login, me, upload, asset]), async () => { starts += 1; return null; }, async () => { stops += 1; return null; });
  const client = await bridge.testClient(app, new Map([[user, {id: "override"}]]));
  assert.equal(starts, 1);
  try {
    await assert.rejects(client.get("/safe/%2e%2e/asset"), /unsafe encoded segment/u);
    await assert.rejects(client.get("/asset?value=%FF"), /valid percent-encoded UTF-8/u);
    assert.equal((await client.get("/login")).status, 200);
    const response = await client.get("/me");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {id: "override", session: "s1", theme: "dark"});
    assert.equal(realResolves, 0);
    const multipart = await client.post("/upload", {form: new Map([["title", "cover"]]), files: new Map([["image", {filename: "cover.txt", contentType: "text/plain", data: "pixels"}]])});
    assert.equal(multipart.status, 200);
    assert.deepEqual(await multipart.json(), {title: "cover", filename: "cover.txt", body: "pixels"});
    const file = await client.get("/asset");
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "file-body");
  } finally {
    await client.close();
    await rm(directory, {recursive: true, force: true});
  }
  assert.equal(stops, 1);
});

test("Node lifecycle unwinds only successfully started hook pairs", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    lifecycle(app: unknown, startup: (() => Promise<null>) | null, shutdown: (() => Promise<null>) | null): unknown;
  }>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createApp(name: string, items: readonly unknown[]): unknown;
    testClient(app: unknown): Promise<{close(): Promise<null>}>;
  };
  const events: string[] = [];
  const base = bridge.createApp("lifecycles", []);
  const first = serveRuntime.lifecycle(
    base,
    async () => { events.push("start:first"); return null; },
    async () => { events.push("stop:first"); return null; },
  );
  const failing = serveRuntime.lifecycle(
    first,
    async () => { events.push("start:second"); throw new Error("startup failed"); },
    async () => { events.push("stop:second"); return null; },
  );
  await assert.rejects(bridge.testClient(failing), /startup failed/u);
  assert.deepEqual(events, ["start:first", "start:second", "stop:first"]);

  events.length = 0;
  const shutdownOnly = serveRuntime.lifecycle(base, null, async () => { events.push("stop:base"); return null; });
  const ready = serveRuntime.lifecycle(
    shutdownOnly,
    async () => { events.push("start:ready"); return null; },
    async () => { events.push("stop:ready"); return null; },
  );
  const client = await bridge.testClient(ready);
  await Promise.all([client.close(), client.close()]);
  assert.deepEqual(events, ["start:ready", "stop:ready", "stop:base"]);
});

test("Node application shutdown joins concurrent callers and drains requests before releasing providers", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly input: {dependency(provider: unknown): unknown};
    provide(inputs: Record<string, unknown>, resolve: (values: Record<string, unknown>) => unknown, scope?: string, release?: ((value: unknown) => unknown) | null): unknown;
    lifecycle(app: unknown, startup: () => unknown, shutdown: () => unknown): unknown;
  }>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createPattern(source: Record<string, unknown>): unknown;
    createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
    createApp(name: string, items: readonly unknown[]): unknown;
    testClient(app: unknown): Promise<{
      get(path: string): Promise<{status: number; json(): Promise<unknown>}>;
      close(): Promise<null>;
    }>;
  };
  let resolveRequests = (): void => {};
  let markEntered = (): void => {};
  const requestCount = 64;
  const requestGate = new Promise<void>((resolveGate) => { resolveRequests = resolveGate; });
  const allEntered = new Promise<void>((resolveEntered) => { markEntered = resolveEntered; });
  const events: string[] = [];
  let entered = 0;
  let providerResolves = 0;
  let providerReleases = 0;
  let shutdowns = 0;
  const singleton = serveRuntime.provide(
    {},
    async () => { providerResolves += 1; return {name: "shared"}; },
    "app",
    async () => { providerReleases += 1; events.push("provider-release"); return null; },
  );
  const route = bridge.createRoute("GET", routePattern(bridge, "/work"), [
    {name: "shared", source: "dependency", kind: "dependency", required: true, check: () => true, input: serveRuntime.input.dependency(singleton)},
  ], async (_path: unknown) => {
    entered += 1;
    if (entered === requestCount) markEntered();
    await requestGate;
    events.push("request-finished");
    return {ok: true};
  });
  const app = serveRuntime.lifecycle(
    bridge.createApp("concurrency", [route]),
    async () => null,
    async () => { shutdowns += 1; events.push("shutdown"); return null; },
  );
  const client = await bridge.testClient(app);
  const requests = Array.from({length: requestCount}, () => client.get("/work"));
  await allEntered;
  let closeFinished = false;
  const firstClose = client.close().then((value) => { closeFinished = true; return value; });
  const secondClose = client.close();
  await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
  assert.equal(closeFinished, false, "close must wait for every request that already entered the application");
  await assert.rejects(client.get("/work"), /server-test client is closed/u);
  resolveRequests();
  const responses = await Promise.all(requests);
  assert.equal(responses.length, requestCount);
  for (const response of responses) assert.equal(response.status, 200);
  await Promise.all([firstClose, secondClose]);
  assert.equal(providerResolves, 1, "an app provider initializes exactly once under concurrent demand");
  assert.equal(providerReleases, 1, "concurrent close calls release an app provider exactly once");
  assert.equal(shutdowns, 1, "concurrent close calls run shutdown exactly once");
  assert.equal(events.filter((event) => event === "request-finished").length, requestCount);
  assert.deepEqual(events.slice(-2), ["provider-release", "shutdown"]);
});

test("Node timeout ownership survives middleware that replaces the timeout response", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly input: {dependency(provider: unknown): unknown};
    readonly middleware: {timeout(milliseconds: number): unknown};
    provide(inputs: Record<string, unknown>, resolve: () => Promise<unknown>, scope?: string, release?: (value: unknown) => Promise<null>): unknown;
    use(app: unknown, middleware: readonly unknown[]): unknown;
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(grace?: number): Promise<null>}>;
  }>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createPattern(source: Record<string, unknown>): unknown;
    createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
    createApp(name: string, items: readonly unknown[]): unknown;
  };
  let enter = (): void => {};
  let finish = (): void => {};
  const entered = new Promise<void>((resolveEntered) => { enter = resolveEntered; });
  const gate = new Promise<void>((resolveGate) => { finish = resolveGate; });
  let releases = 0;
  const dependency = serveRuntime.provide({}, async () => ({value: "owned"}), "request", async () => { releases += 1; return null; });
  const route = bridge.createRoute("GET", routePattern(bridge, "/slow"), [
    {name: "owned", source: "dependency", kind: "dependency", required: true, check: () => true, input: serveRuntime.input.dependency(dependency)},
  ], async (_path: unknown) => { enter(); await gate; return {ok: true}; });
  const app = serveRuntime.use(bridge.createApp("timeout-ownership", [route]), [
    async (_request: unknown, next: () => Promise<unknown>) => { await next(); return {status: 200, json: {replaced: true}}; },
    serveRuntime.middleware.timeout(5),
  ]);
  const server = await serveRuntime.serve(app, 0);
  const responsePromise = fetch(`http://127.0.0.1:${server.port}/slow`);
  await entered;
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {replaced: true});
  assert.equal(releases, 0, "replacing a timeout response must not release the still-running request scope");
  let stopped = false;
  const stop = server.stop(1000).then((value) => { stopped = true; return value; });
  await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
  assert.equal(stopped, false, "graceful stop must still see the timed-out downstream request");
  finish();
  await stop;
  assert.equal(releases, 1);
});

test("Node serve reserves concurrent starts and joins concurrent stops", async () => {
  const serveRuntime = await runtime<{
    serve(handler: () => Promise<unknown>, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const handler = async () => ({status: 200, json: {ok: true}});
  const [first, second] = await Promise.all([serveRuntime.serve(handler, 0), serveRuntime.serve(handler, 0)]);
  assert.notEqual(first.port, second.port);
  try {
    const responses = await Promise.all([
      fetch(`http://127.0.0.1:${first.port}/`),
      fetch(`http://127.0.0.1:${second.port}/`),
    ]);
    assert.deepEqual(await Promise.all(responses.map((response) => response.json())), [{ok: true}, {ok: true}]);
  } finally {
    await Promise.all([first.stop(), first.stop(), second.stop(), second.stop()]);
  }
});

test("Node serve cancellation cooperatively drains handlers before shutdown", async () => {
  const serveRuntime = await runtime<{
    serve(
      handler: (request: {readonly cancellation: {readonly cancelled: boolean; readonly reason: string | null}}) => Promise<unknown>,
      port: number,
    ): Promise<{readonly port: number; stop(grace?: number): Promise<null>}>;
  }>("velar/serve");
  let entered = (): void => {};
  const ready = new Promise<void>((resolveReady) => { entered = resolveReady; });
  let cancellationReason: string | null = null;
  const server = await serveRuntime.serve(async request => {
    entered();
    while (!request.cancellation.cancelled) await new Promise<void>((resolveWait) => setTimeout(resolveWait, 2));
    cancellationReason = request.cancellation.reason;
    return {status: 200, text: "stopped"};
  }, 0);
  const response = fetch(`http://127.0.0.1:${server.port}/wait`);
  await ready;
  await server.stop(1000);
  assert.equal(cancellationReason, "Server is stopping");
  assert.equal((await response).status, 200);
});
