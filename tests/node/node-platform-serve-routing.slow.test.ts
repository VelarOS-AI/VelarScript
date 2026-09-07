import assert from "node:assert/strict";
import test from "node:test";
import { routePattern, runtime } from "../support/node-runtime.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is how a `velar/serve` application binds a request to a handler:
 * the one bounded fallback an unmatched path reaches, the security, cookies
 * and scoped providers a route input resolves, the owned application resource
 * `supply` binds, and the docs and built-in middleware that sit in front of
 * all three.
 */

test("Node ServeApp exposes one bounded unmatched-path fallback without intercepting route errors or 405", async () => {
  const serveRuntime = await runtime<{
    readonly HttpProblem: new (options: Record<string, unknown>) => Error;
    readonly ServeApp: object;
    bodyLimit(app: unknown, maxBytes: number): unknown;
    docs(app: unknown, title?: string, version?: string): unknown;
    json(value: unknown, status?: number): unknown;
    lifecycle(app: unknown, startup?: (() => Promise<unknown>) | null, shutdown?: (() => Promise<unknown>) | null): unknown;
    prefix(path: string, app: unknown): unknown;
    use(app: unknown, middleware: (request: unknown, next: () => Promise<unknown>) => Promise<unknown>): unknown;
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createPattern(source: Record<string, unknown>): unknown;
    createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
    createNotFound(handler: (...arguments_: never[]) => Promise<unknown>): unknown;
    createApp(name: string, items: readonly unknown[]): unknown;
  } | undefined;
  assert.ok(bridge);

  let fallbackCalls = 0;
  let middlewareCalls = 0;
  const health = bridge.createRoute("GET", routePattern(bridge, "/health"), [], async () => ({ok: true}));
  const routeOwnedMissing = bridge.createRoute("GET", routePattern(bridge, "/route-missing"), [], async () => {
    throw new serveRuntime.HttpProblem({status: 404, reason: "route.owned", title: "Route-owned failure"});
  });
  const fallback = bridge.createNotFound(async (request: {readonly path: string}) => {
    fallbackCalls += 1;
    return {error: "route_not_found", path: request.path};
  });
  assert.throws(() => bridge.createApp("duplicate", [fallback, fallback]), /more than one @notFound fallback/u);

  const source = bridge.createApp("api", [health, routeOwnedMissing, fallback]);
  assert.throws(() => serveRuntime.prefix("/api", source), /cannot scope @notFound/u);
  let app = serveRuntime.bodyLimit(source, 1024);
  app = serveRuntime.use(app, async (_request, next) => {
    middlewareCalls += 1;
    return next();
  });
  app = serveRuntime.lifecycle(app, async () => null, async () => null);
  app = serveRuntime.docs(app, "Fallback API", "1.0.0");

  const server = await serveRuntime.serve(app, 0);
  try {
    const unknown = await fetch(`http://127.0.0.1:${server.port}/api/missing?source=test`);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), {error: "route_not_found", path: "/api/missing"});
    assert.equal(fallbackCalls, 1);
    assert.equal(middlewareCalls, 1, "application middleware must wrap the fallback once");

    const routeError = await fetch(`http://127.0.0.1:${server.port}/route-missing`);
    assert.equal(routeError.status, 404);
    assert.equal(((await routeError.json()) as {code: string}).code, "route.owned");
    assert.equal(fallbackCalls, 1, "an explicitly matched route owns its HttpProblem response");

    const wrongMethod = await fetch(`http://127.0.0.1:${server.port}/health`, {method: "POST"});
    assert.equal(wrongMethod.status, 405);
    assert.equal(((await wrongMethod.json()) as {code: string}).code, "route.method_not_allowed");
    assert.equal(fallbackCalls, 1, "method-not-allowed is not an unmatched path");
  } finally {
    await server.stop();
  }

  const defaultServer = await serveRuntime.serve(bridge.createApp("default", [health]), 0);
  try {
    const unknown = await fetch(`http://127.0.0.1:${defaultServer.port}/missing`);
    assert.equal(unknown.status, 404);
    assert.equal(((await unknown.json()) as {code: string}).code, "route.not_found");
  } finally {
    await defaultServer.stop();
  }

  const explicit = bridge.createNotFound(async () => serveRuntime.json({error: "gone"}, 410));
  const explicitServer = await serveRuntime.serve(bridge.createApp("explicit", [explicit]), 0);
  try {
    const unknown = await fetch(`http://127.0.0.1:${explicitServer.port}/missing`);
    assert.equal(unknown.status, 410);
    assert.deepEqual(await unknown.json(), {error: "gone"});
  } finally {
    await explicitServer.stop();
  }
});

test("Node route input values resolve security, cookies, and scoped providers", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly Provider: {is(value: unknown): boolean};
    readonly input: {
      cookie(name?: string, fallback?: string | null): unknown;
      dependency(provider: unknown): unknown;
    };
    readonly security: { bearer(): unknown };
    __velarServeAuthenticationCredential(credential: unknown): unknown;
    provide(inputs: Record<string, unknown>, resolve: (values: Record<string, unknown>) => unknown, scope?: string, release?: ((value: unknown) => unknown) | null, eager?: boolean): unknown;
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  assert.throws(
    () => serveRuntime.__velarServeAuthenticationCredential(serveRuntime.input.cookie("session")),
    /requires a security credential descriptor/u,
  );
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createPattern(source: Record<string, unknown>): unknown;
    createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
    createApp(name: string, items: readonly unknown[]): unknown;
  };
  let requestResolves = 0;
  let requestReleases = 0;
  let appResolves = 0;
  let appReleases = 0;
  const currentUser = serveRuntime.provide(
    {token: serveRuntime.security.bearer()},
    async ({token}) => { requestResolves += 1; return {id: token}; },
    "request",
    async () => { requestReleases += 1; },
  );
  assert.equal(serveRuntime.Provider.is(currentUser), true);
  const settings = serveRuntime.provide(
    {},
    async () => { appResolves += 1; return {region: "local"}; },
    "app",
    async () => { appReleases += 1; },
    true,
  );
  const route = bridge.createRoute("GET", routePattern(bridge, "/me"), [
    {name: "first", source: "dependency", kind: "dependency", required: true, check: () => true, input: serveRuntime.input.dependency(currentUser)},
    {name: "second", source: "dependency", kind: "dependency", required: true, check: () => true, input: serveRuntime.input.dependency(currentUser)},
    {name: "settings", source: "dependency", kind: "dependency", required: true, check: () => true, input: serveRuntime.input.dependency(settings)},
    {name: "session", source: "cookie", kind: "string", required: true, check: (value: unknown) => typeof value === "string" || value === null, input: serveRuntime.input.cookie("session", null)},
  ], async (_path: unknown, first: {id: string}, second: {id: string}, appSettings: {region: string}, session: string | null) => ({first: first.id, second: second.id, region: appSettings.region, session}));
  const server = await serveRuntime.serve(bridge.createApp("inputs", [route]), 0);
  assert.equal(appResolves, 1, "eager app providers initialize before serve resolves");
  try {
    const missing = await fetch(`http://127.0.0.1:${server.port}/me`);
    assert.equal(missing.status, 401);
    assert.equal(requestReleases, 0);

    const response = await fetch(`http://127.0.0.1:${server.port}/me`, {headers: {authorization: "Bearer user-1", cookie: "session=s-1"}});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {first: "user-1", second: "user-1", region: "local", session: "s-1"});
    const releaseDeadline = Date.now() + 1000;
    while (requestReleases === 0 && Date.now() < releaseDeadline) await new Promise<void>((resolve) => setTimeout(resolve, 5));
    assert.equal(requestResolves, 1, "a request provider resolves once even when injected twice");
    assert.equal(requestReleases, 1, "request providers release after the response completes");

    const withoutCookie = await fetch(`http://127.0.0.1:${server.port}/me`, {headers: {authorization: "Bearer user-2"}});
    assert.deepEqual(await withoutCookie.json(), {first: "user-2", second: "user-2", region: "local", session: null});
    assert.equal(appResolves, 1, "an app provider is cached across requests");
  } finally {
    await server.stop();
  }
  assert.equal(appReleases, 1, "app providers release during server shutdown");
});

test("Node ServeApp supply binds an owned application resource without global state", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly input: {dependency(provider: unknown): unknown};
    provide(inputs: Record<string, unknown>, resolve: () => unknown, scope?: string, release?: ((value: unknown) => unknown) | null): unknown;
    supply(app: unknown, provider: unknown, value: unknown): unknown;
    prefix(path: string, app: unknown): unknown;
    use(app: unknown, middleware: (request: unknown, next: () => Promise<unknown>) => Promise<unknown>): unknown;
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createPattern(source: Record<string, unknown>): unknown;
    createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
    createApp(name: string, items: readonly unknown[]): unknown;
    testClient(app: unknown, overrides?: Map<unknown, unknown>): Promise<{get(path: string): Promise<{status: number; json(): Promise<unknown>}>; close(): Promise<null>}>;
  };
  let fallbackResolves = 0;
  const released: unknown[] = [];
  const applicationProvider = serveRuntime.provide(
    {},
    async () => { fallbackResolves += 1; return {name: "fallback"}; },
    "app",
    async (value) => { released.push(value); return null; },
  );
  const route = bridge.createRoute("GET", routePattern(bridge, "/health"), [
    {name: "application", source: "dependency", kind: "dependency", required: true, check: () => true, input: serveRuntime.input.dependency(applicationProvider)},
  ], async (_path: unknown, application: {name: string}) => ({name: application.name}));
  const suppliedValue = {name: "OpenVoxel"};
  const composed = serveRuntime.use(
    serveRuntime.prefix("/api", serveRuntime.supply(bridge.createApp("supplied", [route]), applicationProvider, suppliedValue)),
    async (_request, next) => await next(),
  );
  const server = await serveRuntime.serve(composed, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {name: "OpenVoxel"});
    assert.equal(fallbackResolves, 0);
  } finally { await server.stop(); }
  assert.deepEqual(released, [suppliedValue], "the provider release owns the supplied production value");

  const overrideValue = {name: "test"};
  const client = await bridge.testClient(composed, new Map([[applicationProvider, overrideValue]]));
  try {
    assert.deepEqual(await (await client.get("/api/health")).json(), overrideValue);
  } finally { await client.close(); }
  assert.deepEqual(released, [suppliedValue], "test overrides do not adopt or release the production binding");

  const requestProvider = serveRuntime.provide({}, async () => null, "request");
  assert.throws(() => serveRuntime.supply(composed, requestProvider, null), /only app-scoped Providers/u);
  assert.throws(() => serveRuntime.supply(composed, applicationProvider, suppliedValue), /same Provider more than once/u);
});

test("Node docs and built-in middleware provide offline OpenAPI, security, CORS, headers, and compression", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly RouteDocumentation: {is(value: unknown): boolean};
    readonly security: {bearer(): unknown; apiKey(name: string): unknown};
    readonly middleware: {
      cors(origins?: string[]): unknown;
      requestId(): unknown;
      securityHeaders(): unknown;
      compression(minimumBytes?: number): unknown;
    };
    use(app: unknown, middleware: unknown[]): unknown;
    docs(app: unknown, title?: string | null, version?: string): unknown;
    sse(producer: (send: (event: unknown) => Promise<null>) => Promise<null>): unknown;
    openapi(app: unknown, title?: string | null, version?: string): {components?: {securitySchemes: Record<string, unknown>}; paths: Record<string, unknown>};
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as {
    createPattern(source: Record<string, unknown>): unknown;
    createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>, metadata?: Record<string, unknown>): unknown;
    createApp(name: string, items: readonly unknown[]): unknown;
  };
  const token = serveRuntime.security.bearer();
  const apiKey = serveRuntime.security.apiKey("x-api-key");
  assert.equal(serveRuntime.RouteDocumentation.is({summary: "Read data", errors: new Map([[401, "Missing credentials"]])}), true);
  assert.equal(serveRuntime.RouteDocumentation.is({status: 199}), false, "OpenAPI metadata cannot advertise an informational response as a final route result");
  assert.equal(serveRuntime.RouteDocumentation.is({status: 200}), true);
  const route = bridge.createRoute("GET", routePattern(bridge, "/data", [{name: "limit", kind: "number", optional: true}]), [
    {name: "token", source: "security", kind: "security", required: true, check: () => true, input: token},
    {name: "apiKey", source: "security", kind: "security", required: true, check: () => true, input: apiKey},
  ], async (_path: unknown, credential: string) => ({credential, payload: "x".repeat(4096)}), {responseSchema: {type: "object"}});
  const events = bridge.createRoute("GET", routePattern(bridge, "/events"), [], async () => serveRuntime.sse(async (send) => {
    await send({event: "ready", id: "1", retry: 1000, data: "first\nsecond"});
    return null;
  }));
  const app = bridge.createApp("api", [route, events]);
  const document = serveRuntime.openapi(app, "Secure API", "1.2.0");
  assert.equal(Object.keys(document.components?.securitySchemes ?? {}).length, 2);
  const securityRequirements = (document.paths["/data"] as {get?: {security?: Record<string, unknown>[]}}).get?.security ?? [];
  assert.equal(securityRequirements.length, 1, "multiple route security inputs form one OpenAPI AND requirement");
  assert.equal(Object.keys(securityRequirements[0] ?? {}).length, 2);
  const wrapped = serveRuntime.use(app, [
    serveRuntime.middleware.cors(["https://client.test"]),
    serveRuntime.middleware.requestId(),
    serveRuntime.middleware.securityHeaders(),
    serveRuntime.middleware.compression(128),
  ]);
  const documented = (serveRuntime.docs as unknown as (app: unknown, title: string, version: string, path: string, openapiPath: string, routes: Map<string, unknown>) => unknown)(
    wrapped,
    "Secure API",
    "1.2.0",
    "/docs",
    "/openapi.json",
    new Map([["GET /data", {summary: "Read data", description: "Returns protected data.", tags: ["data"], status: 202, errors: new Map([[401, "Missing credentials"]])}]]),
  );
  const server = await serveRuntime.serve(documented, 0);
  try {
    const schema = await fetch(`http://127.0.0.1:${server.port}/openapi.json`);
    assert.equal(schema.status, 200);
    const schemaDocument = await schema.json() as {info: {title: string}; paths: {"/data": {get: {summary: string; tags: string[]; responses: Record<string, {description: string}>}}}};
    assert.equal(schemaDocument.info.title, "Secure API");
    assert.equal(schemaDocument.paths["/data"].get.summary, "Read data");
    assert.deepEqual(schemaDocument.paths["/data"].get.tags, ["data"]);
    assert.equal(schemaDocument.paths["/data"].get.responses["202"]?.description, "Successful response");
    assert.equal(schemaDocument.paths["/data"].get.responses["401"]?.description, "Missing credentials");
    assert.equal(schemaDocument.paths["/data"].get.responses["422"]?.description, "Request validation failed");
    const ui = await fetch(`http://127.0.0.1:${server.port}/docs`);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /bundled offline documentation/u);

    const unauthorized = await fetch(`http://127.0.0.1:${server.port}/data`);
    assert.equal(unauthorized.status, 401);
    const response = await fetch(`http://127.0.0.1:${server.port}/data`, {headers: {authorization: "Bearer token-1", "x-api-key": "key-1", origin: "https://client.test", "accept-encoding": "gzip"}});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://client.test");
    assert.match(response.headers.get("vary") ?? "", /Origin/u);
    assert.match(response.headers.get("vary") ?? "", /Accept-Encoding/u);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok(response.headers.get("x-request-id"));
    const noCompression = await fetch(`http://127.0.0.1:${server.port}/data`, {headers: {authorization: "Bearer token-1", "x-api-key": "key-1", "accept-encoding": "br;q=0, gzip;q=0"}});
    assert.equal(noCompression.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.equal((await response.json() as {credential: string}).credential, "token-1");
    const eventStream = await fetch(`http://127.0.0.1:${server.port}/events`);
    assert.match(eventStream.headers.get("content-type") ?? "", /^text\/event-stream/u);
    assert.equal(await eventStream.text(), "event: ready\nid: 1\nretry: 1000\ndata: first\ndata: second\n\n");
  } finally {
    await server.stop();
  }
});
