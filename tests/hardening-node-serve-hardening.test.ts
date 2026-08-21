import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { nodeModuleDependencies, nodeModuleSources } from "../packages/node/src/compiler.ts";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";

// The velar/serve runtime is emitted-style source, so every hardening
// regression here loads the real module and drives it over a real port.
async function runtime<T>(
  name: string,
  transform: (source: string) => string = (source) => source,
  transformDependency: (name: string, source: string) => string = (_name, source) => source,
): Promise<T> {
  const source = nodeModuleSources.get(name);
  assert.ok(source, `${name} must have a Node runtime source`);
  const directory = await mkdtemp(join(tmpdir(), "velar-node-runtime-"));
  await materializeNodeRuntimeDependencies(directory, name, transformDependency);
  const path = join(directory, `${name.slice("velar/".length)}.mjs`);
  await writeFile(path, transform(source), "utf8");
  const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as T;
  await rm(directory, { recursive: true, force: true });
  return module;
}

async function materializeNodeRuntimeDependencies(
  directory: string,
  source: string,
  transform: (name: string, source: string) => string = (_name, value) => value,
): Promise<void> {
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
  await mkdir(root, {recursive: true});
  const exports_: Record<string, string> = {};
  for (const dependency of dependencies) {
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource, `missing Node runtime dependency ${dependency}`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), transform(dependency, moduleSource), "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
}

interface ServeBridge {
  createRoute(method: string, path: string, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>, metadata?: Record<string, unknown>): unknown;
  createApp(name: string, items: readonly unknown[]): unknown;
  createNotFound(handler: (...arguments_: never[]) => Promise<unknown>, middleware?: readonly unknown[]): unknown;
}

function serveBridge(app: object): ServeBridge {
  return Object.getOwnPropertyDescriptor(app, "__velarCompilerBridge")?.value as ServeBridge;
}

// console.error is captured by value when velar/serve loads, so stderr is
// observed at the stream instead of at the console object.
async function captureStderr<T>(body: () => Promise<T>): Promise<{value: T; stderr: string}> {
  const original = process.stderr.write;
  let captured = "";
  (process.stderr as unknown as {write: unknown}).write = (chunk: unknown): boolean => {
    captured += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  };
  try {
    const value = await body();
    await new Promise<void>((settle) => setTimeout(settle, 25));
    return {value, stderr: captured};
  } finally {
    (process.stderr as unknown as {write: unknown}).write = original;
  }
}

function multipartBody(boundary: string, parts: readonly {name: string; filename?: string; contentType?: string; value: string}[]): string {
  let body = `--${boundary}`;
  for (const part of parts) {
    body += `\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) body += `; filename="${part.filename}"`;
    body += `\r\nContent-Type: ${part.contentType ?? "text/plain"}\r\n\r\n${part.value}\r\n--${boundary}`;
  }
  return `${body}--\r\n`;
}

test("middleware.cors refuses a credentialed origin wildcard at construction", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly middleware: {cors(origins?: readonly string[], methods?: readonly string[], headers?: readonly string[], credentials?: boolean, maxAge?: number): unknown};
    use(app: unknown, middleware: readonly unknown[]): unknown;
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const bridge = serveBridge(serveRuntime.ServeApp);

  assert.throws(
    () => serveRuntime.middleware.cors(undefined, undefined, undefined, true),
    /middleware\.cors cannot combine credentials with the '\*' origin wildcard/u,
    "the default wildcard origin cannot be combined with credentials",
  );
  assert.throws(
    () => serveRuntime.middleware.cors(["*"], undefined, undefined, true),
    /middleware\.cors cannot combine credentials with the '\*' origin wildcard/u,
    "an explicit wildcard origin cannot be combined with credentials",
  );
  assert.throws(
    () => serveRuntime.middleware.cors(["https://client.test", "*"], undefined, undefined, true),
    /middleware\.cors cannot combine credentials with the '\*' origin wildcard/u,
    "a wildcard beside a named origin still reflects every origin",
  );
  assert.doesNotThrow(() => serveRuntime.middleware.cors(), "the wildcard default remains available without credentials");
  assert.doesNotThrow(() => serveRuntime.middleware.cors(["*"], undefined, undefined, false));

  const route = bridge.createRoute("GET", "/data", [], async () => ({ok: true}));
  const app = serveRuntime.use(bridge.createApp("cors", [route]), [
    serveRuntime.middleware.cors(["https://client.test"], undefined, undefined, true),
  ]);
  const server = await serveRuntime.serve(app, 0);
  try {
    const allowed = await fetch(`http://127.0.0.1:${server.port}/data`, {headers: {origin: "https://client.test"}});
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://client.test");
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");

    const refused = await fetch(`http://127.0.0.1:${server.port}/data`, {headers: {origin: "https://evil.example"}});
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), {error: "origin_not_allowed"});
    assert.equal(refused.headers.get("access-control-allow-origin"), null);
    assert.equal(refused.headers.get("access-control-allow-credentials"), null);
  } finally {
    await server.stop();
  }
});

test("a malformed explicit response fails closed instead of becoming a success body", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const bridge = serveBridge(serveRuntime.ServeApp);
  const routes = [
    bridge.createRoute("GET", "/extra-field", [], async () => ({status: 403, json: {error: "forbidden"}, extra: 1})),
    bridge.createRoute("GET", "/status-text", [], async () => ({status: "403", json: {error: "forbidden"}})),
    bridge.createRoute("GET", "/two-bodies", [], async () => ({status: 401, json: {error: "forbidden"}, text: ""})),
    bridge.createRoute("GET", "/status-range", [], async () => ({status: 999, json: {error: "forbidden"}})),
    bridge.createRoute("GET", "/denied", [], async () => ({status: 403, json: {error: "forbidden"}})),
    bridge.createRoute("GET", "/plain", [], async () => ({ok: true})),
    bridge.createRoute("GET", "/record-with-status", [], async () => ({id: 1, status: "active"})),
    bridge.createNotFound(async () => ({status: 410, json: {error: "gone"}, extra: 1})),
  ];
  const server = await serveRuntime.serve(bridge.createApp("responses", routes), 0);
  try {
    const {value: statuses, stderr} = await captureStderr(async () => {
      const paths = ["/extra-field", "/status-text", "/two-bodies", "/status-range"];
      const output: number[] = [];
      for (const path of paths) {
        const response = await fetch(`http://127.0.0.1:${server.port}${path}`);
        output[output.length] = response.status;
        assert.equal(await response.text(), "Internal server error", `${path} must not deliver the malformed record as a body`);
      }
      const fallback = await fetch(`http://127.0.0.1:${server.port}/no-such-route`);
      output[output.length] = fallback.status;
      return output;
    });
    assert.deepEqual(statuses, [500, 500, 500, 500, 500], "a rejected explicit response never degrades into 200 or 404");
    assert.match(stderr, /Unhandled server request failed/u, "the malformed response is reported on stderr");

    const denied = await fetch(`http://127.0.0.1:${server.port}/denied`);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), {error: "forbidden"});

    const plain = await fetch(`http://127.0.0.1:${server.port}/plain`);
    assert.equal(plain.status, 200);
    assert.deepEqual(await plain.json(), {ok: true});

    const record = await fetch(`http://127.0.0.1:${server.port}/record-with-status`);
    assert.equal(record.status, 200, "ordinary Data that owns a status field but no body field still returns JSON");
    assert.deepEqual(await record.json(), {id: 1, status: "active"});
  } finally {
    await server.stop();
  }

  const wellFormedFallback = bridge.createApp("fallback", [
    bridge.createRoute("GET", "/health", [], async () => ({ok: true})),
    bridge.createNotFound(async () => ({error: "route_not_found"})),
  ]);
  const fallbackServer = await serveRuntime.serve(wellFormedFallback, 0);
  try {
    const missing = await fetch(`http://127.0.0.1:${fallbackServer.port}/nowhere`);
    assert.equal(missing.status, 404, "@notFound returning Data keeps status 404");
    assert.deepEqual(await missing.json(), {error: "route_not_found"});
  } finally {
    await fallbackServer.stop();
  }
});

test("a duplicated cookie name is refused instead of resolving to the first value", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly input: {cookie(name?: string, fallback?: string | null): unknown};
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const bridge = serveBridge(serveRuntime.ServeApp);
  const route = bridge.createRoute("GET", "/me", [
    {name: "session", source: "cookie", kind: "string", required: true, check: (value: unknown) => typeof value === "string" || value === null, input: serveRuntime.input.cookie("session", null)},
  ], async (session: string | null) => ({session}));
  const server = await serveRuntime.serve(bridge.createApp("cookies", [route]), 0);
  try {
    const single = await fetch(`http://127.0.0.1:${server.port}/me`, {headers: {cookie: "session=REAL"}});
    assert.equal(single.status, 200);
    assert.deepEqual(await single.json(), {session: "REAL"});

    const absent = await fetch(`http://127.0.0.1:${server.port}/me`);
    assert.equal(absent.status, 200);
    assert.deepEqual(await absent.json(), {session: null});

    for (const cookie of ["session=ATTACKER; session=REAL", "session=REAL; session=ATTACKER"]) {
      const duplicated = await fetch(`http://127.0.0.1:${server.port}/me`, {headers: {cookie}});
      assert.equal(duplicated.status, 400, `${cookie} is ambiguous and must not silently pick a winner`);
      assert.deepEqual(await duplicated.json(), {error: "duplicate_cookie", parameter: "session"});
    }

    const otherNames = await fetch(`http://127.0.0.1:${server.port}/me`, {headers: {cookie: "theme=dark; session=REAL; locale=en"}});
    assert.equal(otherNames.status, 200);
    assert.deepEqual(await otherNames.json(), {session: "REAL"});

    const undecodable = await fetch(`http://127.0.0.1:${server.port}/me`, {headers: {cookie: "session=%E0%A4%A"}});
    assert.equal(undecodable.status, 400);
    assert.deepEqual(await undecodable.json(), {error: "invalid_cookie", parameter: "session"});
  } finally {
    await server.stop();
  }
});

test("middleware.timeout bounds detached continuations instead of live requests", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly middleware: {timeout(milliseconds: number): unknown};
    use(app: unknown, middleware: readonly unknown[]): unknown;
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const bridge = serveBridge(serveRuntime.ServeApp);

  // Every one of these 300 continuations is inside the middleware before any
  // of them settles, which is exactly the state the process cap used to refuse.
  const timeout = serveRuntime.middleware.timeout(30_000) as (request: unknown, next: () => Promise<unknown>) => Promise<{status: number}>;
  let release = (): void => {};
  const gate = new Promise<void>((settle) => { release = settle; });
  const inflight: Promise<{status: number}>[] = [];
  for (let index = 0; index < 300; index += 1) inflight[index] = timeout({}, async () => { await gate; return {status: 200, json: {ok: true}}; });
  await new Promise<void>((settle) => setTimeout(settle, 20));
  release();
  const settled = await Promise.all(inflight);
  assert.equal(settled.filter((item) => item.status === 503).length, 0, "an attached deadline must not cap process concurrency");
  assert.equal(settled.filter((item) => item.status === 200).length, 300);

  const slow = bridge.createRoute("GET", "/slow", [], async () => { await new Promise<void>((settle) => setTimeout(settle, 100)); return {ok: true}; });
  const fast = bridge.createRoute("GET", "/fast", [], async () => ({ok: true}));
  const concurrent = serveRuntime.use(bridge.createApp("timeouts", [slow, fast]), [serveRuntime.middleware.timeout(30_000)]);
  const server = await serveRuntime.serve(concurrent, 0);
  try {
    const responses = await Promise.all(Array.from({length: 300}, () => fetch(`http://127.0.0.1:${server.port}/slow`)));
    const statuses = responses.map((response) => response.status);
    await Promise.all(responses.map((response) => response.text()));
    assert.equal(statuses.filter((status) => status === 503).length, 0, "300 concurrent requests behind one deadline must all be served");
    assert.equal(statuses.filter((status) => status === 200).length, 300);
  } finally {
    await server.stop();
  }

  // 300 real detachments, drained between waves, so the counter is shown to
  // release each continuation as it settles. The bound itself is held under a
  // single undrained burst by the next test.
  const expiring = bridge.createRoute("GET", "/expiring", [], async () => { await new Promise<void>((settle) => setTimeout(settle, 120)); return {ok: true}; });
  const deadlined = serveRuntime.use(bridge.createApp("detached", [expiring, fast]), [serveRuntime.middleware.timeout(20)]);
  const detachedServer = await serveRuntime.serve(deadlined, 0);
  try {
    let detachments = 0;
    const {stderr} = await captureStderr(async () => {
      for (let wave = 0; wave < 6; wave += 1) {
        const responses = await Promise.all(Array.from({length: 50}, () => fetch(`http://127.0.0.1:${detachedServer.port}/expiring`)));
        for (const response of responses) {
          assert.equal(response.status, 504);
          assert.deepEqual(await response.json(), {error: "request_timeout"});
          detachments += 1;
        }
        await new Promise<void>((settle) => setTimeout(settle, 250));
      }
      return null;
    });
    assert.equal(detachments, 300, "every deadline expiry detaches its continuation");
    assert.doesNotMatch(stderr, /Unhandled server request failed/u, "a detached continuation that completes is not a failure");
    const admitted = await fetch(`http://127.0.0.1:${detachedServer.port}/fast`);
    assert.equal(admitted.status, 200, "the detached-continuation counter drains and admits later requests");
    assert.deepEqual(await admitted.json(), {ok: true});
  } finally {
    await detachedServer.stop();
  }
});

test("middleware.timeout holds its detached-continuation bound under one undrained burst", async () => {
  // The bound is what docs/standard-library.md publishes and what
  // __velarServeRunBackground subtracts from the process background total, so
  // it has to be a count of live continuations, not an admission check. Four
  // stands in for 256 so one burst can overshoot it cheaply.
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly middleware: {timeout(milliseconds: number): unknown};
    use(app: unknown, middleware: readonly unknown[]): unknown;
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve", (source) => {
    const injected = source.replace("const __velarServeMaxActiveTimeouts = 256;", "const __velarServeMaxActiveTimeouts = 4;");
    assert.notEqual(injected, source, "the detached-continuation bound must stay one named constant");
    return injected;
  });
  const bridge = serveBridge(serveRuntime.ServeApp);

  let release = (): void => {};
  const gate = new Promise<void>((settle) => { release = settle; });
  const held = bridge.createRoute("GET", "/held", [], async () => { await gate; return {ok: true}; });
  const app = serveRuntime.use(bridge.createApp("burst", [held]), [serveRuntime.middleware.timeout(150)]);
  const server = await serveRuntime.serve(app, 0);
  try {
    // All ten are inside the middleware before the first deadline expires, so
    // admission sees an empty counter for every one of them and they expire
    // together. Only four may detach; the rest wait for the handler they have
    // already cancelled rather than becoming unaccounted background work.
    const answered = new Set<number>();
    const burst = Array.from({length: 10}, (_item, index) => fetch(`http://127.0.0.1:${server.port}/held`).then(async (response) => {
      answered.add(index);
      return {status: response.status, body: await response.json() as {error?: string}};
    }));
    await new Promise<void>((settle) => setTimeout(settle, 600));
    assert.equal(answered.size, 4, "a burst that expires together cannot detach past the bound");

    release();
    const settled = await Promise.all(burst);
    assert.equal(settled.filter((item) => item.status === 504).length, 10, "every expired request still reports its own deadline");
    for (const item of settled) assert.deepEqual(item.body, {error: "request_timeout"});

    const drained = await fetch(`http://127.0.0.1:${server.port}/held`);
    assert.equal(drained.status, 200, "the counter drains once the held continuations settle");
    assert.deepEqual(await drained.json(), {ok: true});
  } finally {
    release();
    await server.stop();
  }
});

test("both serve transports answer a static-file miss with the same 404", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-serve-hardening-"));
  try {
    await materializeNodeRuntimeDependencies(directory, "velar/websocket");
    const require = createRequire(import.meta.url);
    await cp(resolve(require.resolve("ws/package.json"), ".."), join(directory, "node_modules", "ws"), {recursive: true});
    const websocketSource = nodeModuleSources.get("velar/websocket");
    assert.ok(websocketSource);
    const websocketPath = join(directory, "websocket.mjs");
    await writeFile(websocketPath, websocketSource, "utf8");
    const assets = join(directory, "assets");
    await mkdir(join(assets, "nested"), {recursive: true});
    await writeFile(join(assets, "index.html"), "<!doctype html>static", "utf8");
    // `relative` writes `..` only as a whole segment, so a top-level file whose
    // own name begins with two dots is contained, not an escape.
    await writeFile(join(assets, "..well-known-legacy.json"), '{"legacy":true}', "utf8");
    await writeFile(join(directory, "secret.txt"), "secret", "utf8");
    const serveRuntime = await import(pathToFileURL(join(directory, "node_modules", "velar", "serve.js")).href) as {
      ServeApp: object;
      staticFiles(path: string, root: string, fallback?: string | null): unknown;
      serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
    };
    const websocket = await import(`${pathToFileURL(websocketPath).href}?hardening=${Date.now()}`) as {
      listen(options: Record<string, unknown>): Promise<{port: number; stop(): Promise<null>}>;
    };
    const bridge = serveBridge(serveRuntime.ServeApp);
    const health = bridge.createRoute("GET", "/health", [], async () => ({ok: true}));
    const app = bridge.createApp("assets", [
      health,
      serveRuntime.staticFiles("/assets", assets),
      serveRuntime.staticFiles("/absent", join(directory, "no-such-root")),
    ]);

    const hostServer = await serveRuntime.serve(app, 0);
    const nativeServer = await websocket.listen({port: 0, host: "127.0.0.1", path: "/ws", http: app});
    try {
      for (const [label, port] of [["host", hostServer.port], ["native", nativeServer.port]] as const) {
        const present = await fetch(`http://127.0.0.1:${port}/assets/index.html`);
        assert.equal(present.status, 200, `${label} transport serves a present asset`);
        assert.equal(await present.text(), "<!doctype html>static");

        const dotted = await fetch(`http://127.0.0.1:${port}/assets/..well-known-legacy.json`);
        assert.equal(dotted.status, 200, `${label} transport serves a top-level name that begins with two dots`);
        assert.equal(await dotted.text(), '{"legacy":true}');

        const {value: misses, stderr} = await captureStderr(async () => {
          const output: {status: number; body: string}[] = [];
          // The last is a static root that does not exist, which used to be a
          // native 500 that also wrote the absolute deployment path to stderr.
          for (const path of ["/assets/nope.html", "/assets/nested", "/assets", "/absent/index.html"]) {
            const response = await fetch(`http://127.0.0.1:${port}${path}`);
            output[output.length] = {status: response.status, body: await response.text()};
          }
          // An encoded escape is refused before it reaches the static handler,
          // so it keeps the router's own not-found body rather than this one.
          const escape = await fetch(`http://127.0.0.1:${port}/assets/%2e%2e/secret.txt`);
          assert.equal(escape.status, 404, `${label} transport refuses an escape out of the root`);
          assert.doesNotMatch(await escape.text(), /secret/u, "a refused escape never returns the outside file");
          return output;
        });
        for (let index = 0; index < misses.length; index += 1) {
          assert.equal(misses[index]!.status, 404, `${label} transport answers static miss ${index} with 404`);
          assert.equal(misses[index]!.body, "Not found", `${label} transport uses the shared 404 body`);
        }
        assert.equal(stderr, "", `${label} transport must not report a static miss as a server failure`);
        assert.doesNotMatch(stderr, /assets/u, "a static miss never leaks the server-side path");
      }
    } finally {
      await nativeServer.stop();
      await hostServer.stop();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("multipart upload filenames are reduced to one bounded file name", async () => {
  const serveRuntime = await runtime<{
    readonly ServeApp: object;
    readonly input: {upload(name?: string, maxBytes?: number): unknown};
    serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>("velar/serve");
  const bridge = serveBridge(serveRuntime.ServeApp);
  const route = bridge.createRoute("POST", "/files", [
    {name: "image", source: "upload", kind: "upload", required: true, check: () => true, input: serveRuntime.input.upload("image", 1024)},
  ], async (image: {filename: string; size: number; text(): Promise<string>}) => ({filename: image.filename, size: image.size, text: await image.text()}));
  const server = await serveRuntime.serve(bridge.createApp("uploads", [route]), 0);
  const boundary = "velar-hardening-boundary";
  const post = async (filename: string): Promise<Response> => fetch(`http://127.0.0.1:${server.port}/files`, {
    method: "POST",
    headers: {"content-type": `multipart/form-data; boundary=${boundary}`},
    body: multipartBody(boundary, [{name: "image", filename, value: "pixels"}]),
  });
  try {
    const plain = await post("cover.txt");
    assert.equal(plain.status, 200);
    assert.deepEqual(await plain.json(), {filename: "cover.txt", size: 6, text: "pixels"});

    const traversal = await post("../escaped.txt");
    assert.equal(traversal.status, 200);
    assert.deepEqual(await traversal.json(), {filename: "escaped.txt", size: 6, text: "pixels"}, "a relative path never survives into Upload.filename");

    const absolute = await post("/etc/passwd");
    assert.equal(absolute.status, 200);
    assert.equal((await absolute.json() as {filename: string}).filename, "passwd");

    const windows = await post("C:\\Users\\x\\cover.txt");
    assert.equal(windows.status, 200);
    assert.equal((await windows.json() as {filename: string}).filename, "cover.txt", "a Windows path is reduced the same way");

    const mixed = await post("uploads\\..\\..\\escaped.txt");
    assert.equal(mixed.status, 200);
    assert.equal((await mixed.json() as {filename: string}).filename, "escaped.txt");

    for (const filename of ["..", ".", "", "uploads/..", "trailing/"]) {
      const refused = await post(filename);
      assert.equal(refused.status, 400, `filename "${filename}" cannot name a file`);
      assert.deepEqual(await refused.json(), {error: "invalid_multipart"});
    }
  } finally {
    await server.stop();
  }
});

test("Upload.save is confined to the root it is given", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-serve-upload-save-"));
  try {
    const uploads = join(directory, "uploads");
    const outside = join(directory, "outside");
    await mkdir(join(uploads, "nested"), {recursive: true});
    await mkdir(outside, {recursive: true});
    await writeFile(join(outside, "target.txt"), "original", "utf8");
    await symlink(outside, join(uploads, "link"), "dir");
    await symlink(join(outside, "target.txt"), join(uploads, "passthrough.txt"));

    const serveRuntime = await runtime<{
      readonly ServeApp: object;
      readonly input: {upload(name?: string, maxBytes?: number): unknown};
      serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
    }>("velar/serve");
    const bridge = serveBridge(serveRuntime.ServeApp);
    // The path and root travel through the test rather than through the request
    // so that every case exercises the same handler that a real application
    // writes: one save call whose arguments the application composed.
    let requested: {path: unknown; root: unknown} = {path: "", root: uploads};
    const route = bridge.createRoute("POST", "/files", [
      {name: "image", source: "upload", kind: "upload", required: true, check: () => true, input: serveRuntime.input.upload("image", 1024)},
    ], async (image: {filename: string; save(path: unknown, root: unknown): Promise<null>}) => {
      // A null path stands for "the application composed the client's own
      // filename", which is the shape the basename reduction already bounds.
      try { await image.save(requested.path === null ? image.filename : requested.path, requested.root); return {saved: true, refused: null}; }
      catch (error) { return {saved: false, refused: (error as Error).message}; }
    });
    const server = await serveRuntime.serve(bridge.createApp("uploads", [route]), 0);
    const save = async (path: unknown, root: unknown, filename = "cover.txt"): Promise<{saved: boolean; refused: string | null}> => {
      requested = {path, root};
      const response = await fetch(`http://127.0.0.1:${server.port}/files`, {
        method: "POST",
        headers: {"content-type": "multipart/form-data; boundary=velar-save-boundary"},
        body: multipartBody("velar-save-boundary", [{name: "image", filename, value: "pixels"}]),
      });
      assert.equal(response.status, 200);
      return await response.json() as {saved: boolean; refused: string | null};
    };
    try {
      assert.deepEqual(await save("cover.txt", uploads), {saved: true, refused: null});
      assert.equal(await readFile(join(uploads, "cover.txt"), "utf8"), "pixels", "a contained save writes where the root says it does");

      assert.deepEqual(await save("nested/cover.txt", uploads), {saved: true, refused: null});
      assert.equal(await readFile(join(uploads, "nested", "cover.txt"), "utf8"), "pixels", "a directory below the root stays contained");

      assert.deepEqual(await save("../escaped.txt", uploads), {saved: false, refused: "Upload.save path escapes its root: it has a '..' segment"});
      assert.deepEqual(await save(join(outside, "escaped.txt"), uploads), {saved: false, refused: "Upload.save path escapes its root: it is absolute"});
      assert.deepEqual(await save("..\\escaped.txt", uploads), {saved: false, refused: "Upload.save path cannot contain a backslash: it is a path separator on some hosts"});
      assert.deepEqual(await save("link/escaped.txt", uploads), {saved: false, refused: "Upload.save path escapes its root through a symbolic link"});
      assert.deepEqual(await save("passthrough.txt", uploads), {saved: false, refused: "Upload.save refuses to write through a symbolic link"});
      assert.equal(await readFile(join(outside, "target.txt"), "utf8"), "original", "a symbolic link at the target is never followed out of the root");
      for (const name of ["escaped.txt", join("nested", "escaped.txt")]) {
        await assert.rejects(readFile(join(outside, name), "utf8"), "no refused save left a file outside the root");
      }

      // A path that is merely unnormalized is still refused — this Realm does not
      // normalize on the caller's behalf — but the refusal cannot claim an escape
      // that did not happen, or the author looks for an attack instead of a typo.
      for (const [path, refused] of [
        ["nested/./cover.txt", "Upload.save path must be normalized: it has a '.' segment"],
        [".", "Upload.save path must be normalized: it has a '.' segment"],
        ["nested//cover.txt", "Upload.save path must be normalized: it has an empty segment"],
        ["nested/", "Upload.save path must be normalized: it has an empty segment"],
      ] as const) assert.deepEqual(await save(path, uploads), {saved: false, refused}, `"${path}" is unnormalized, not an escape`);

      // A host errno names an absolute path the caller never wrote. The refusal
      // names what the caller did write, and nothing about where the root sits.
      const absent = await save("absent/cover.txt", uploads);
      assert.deepEqual(absent, {saved: false, refused: "Upload.save path names a directory that does not exist under the root: absent"});
      assert.deepEqual(await save("cover.txt", join(directory, "no-such-root")), {saved: false, refused: "Upload.save root does not resolve to an existing directory"});
      for (const {refused} of [absent, await save("cover.txt", join(directory, "no-such-root"))]) {
        assert.ok(refused !== null && !refused.includes(directory), "no refusal leaks a host absolute path to the application");
      }

      assert.deepEqual(await save("", uploads), {saved: false, refused: "Upload.save path must be a non-empty path relative to its root"});
      assert.deepEqual(await save("cover.txt", null), {saved: false, refused: "Upload.save root must be a non-empty directory path"}, "the root has no runtime default behind the compile error");

      // The basename reduction and the containment root are complementary: the
      // hostile filename is already one name by the time a handler sees it, and
      // the root is what decides where that name is allowed to land.
      assert.deepEqual(await save(null, uploads, "../escaped.txt"), {saved: true, refused: null});
      assert.equal(await readFile(join(uploads, "escaped.txt"), "utf8"), "pixels", "the reduced filename lands inside the root");
    } finally {
      await server.stop();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("both serve transports shed an exhausted outbound budget as 503 with retry-after", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-serve-budget-"));
  try {
    // The process-global cap is 128 MiB, which no live request can reach in a
    // test, so the emitted runtime is instantiated with a smaller one. Nothing
    // else about the budget path changes: the same reserve, the same throw.
    const shrink = (name: string, source: string): string => name === "velar/serve"
      ? source.replace("const __velarServeMaxOutboundBytes = 128 * 1024 * 1024;", "const __velarServeMaxOutboundBytes = 512;")
      : source;
    await materializeNodeRuntimeDependencies(directory, "velar/websocket", shrink);
    const require = createRequire(import.meta.url);
    await cp(resolve(require.resolve("ws/package.json"), ".."), join(directory, "node_modules", "ws"), {recursive: true});
    const websocketSource = nodeModuleSources.get("velar/websocket");
    assert.ok(websocketSource);
    const websocketPath = join(directory, "websocket.mjs");
    await writeFile(websocketPath, websocketSource, "utf8");
    const serveRuntime = await import(pathToFileURL(join(directory, "node_modules", "velar", "serve.js")).href) as {
      ServeApp: object;
      fileResponse(root: string, path: string, fallback?: string | null): Record<string, unknown>;
      serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
    };
    const websocket = await import(`${pathToFileURL(websocketPath).href}?budget=${Date.now()}`) as {
      listen(options: Record<string, unknown>): Promise<{port: number; stop(): Promise<null>}>;
    };
    await writeFile(join(directory, "large.txt"), "f".repeat(4096), "utf8");
    const bridge = serveBridge(serveRuntime.ServeApp);
    const app = bridge.createApp("budget", [
      bridge.createRoute("GET", "/small", [], async () => ({ok: true})),
      bridge.createRoute("GET", "/large", [], async () => ({text: "x".repeat(4096)})),
      bridge.createRoute("GET", "/decorated", [], async () => ({
        status: 200,
        text: "x".repeat(4096),
        headers: new Map([["x-application-secret", "leaked"], ["set-cookie", "session=abc"]]),
      })),
      bridge.createRoute("GET", "/file", [], async () => serveRuntime.fileResponse(directory, "/large.txt")),
    ]);
    const hostServer = await serveRuntime.serve(app, 0);
    const nativeServer = await websocket.listen({port: 0, host: "127.0.0.1", path: "/ws", http: app});
    try {
      for (const [label, port] of [["host", hostServer.port], ["native", nativeServer.port]] as const) {
        const {value: shed, stderr} = await captureStderr(async () => {
          const response = await fetch(`http://127.0.0.1:${port}/large`);
          return {status: response.status, retryAfter: response.headers.get("retry-after"), body: await response.text()};
        });
        assert.equal(shed.status, 503, `${label} transport answers an exhausted budget with 503`);
        assert.equal(shed.retryAfter, "1", `${label} transport tells the client when to come back`);
        assert.deepEqual(JSON.parse(shed.body), {error: "outbound_budget_exhausted"});
        assert.equal(stderr, "", `${label} transport does not report load shedding as a server failure`);

        // A shed answer is the transport's own, not the application's: the
        // headers staged for the response that never went out belong to it, and
        // a Set-Cookie among them would hand a session to a request that was
        // never served.
        const decorated = await fetch(`http://127.0.0.1:${port}/decorated`);
        assert.equal(decorated.status, 503, `${label} transport sheds a decorated response too`);
        assert.equal(decorated.headers.get("x-application-secret"), null, `${label} transport drops application headers from a shed answer`);
        assert.equal(decorated.headers.get("set-cookie"), null, `${label} transport never sets a cookie for a request it did not serve`);
        assert.deepEqual(JSON.parse(await decorated.text()), {error: "outbound_budget_exhausted"});

        const served = await fetch(`http://127.0.0.1:${port}/small`);
        assert.equal(served.status, 200, `${label} transport keeps serving once the reservation is released`);
        assert.deepEqual(await served.json(), {ok: true});
      }

      // The native transport stages content-length and the file's validators
      // before it streams, so the first over-budget chunk has to clear them:
      // a 503 that still claims 4096 bytes leaves the client waiting for a body
      // that will never arrive, which is a hang rather than an actionable answer.
      const shedFile = await fetch(`http://127.0.0.1:${nativeServer.port}/file`);
      assert.equal(shedFile.status, 503, "a static file over the budget is shed, not streamed");
      assert.equal(shedFile.headers.get("retry-after"), "1");
      assert.equal(shedFile.headers.get("content-length"), null, "no stale content-length survives the shed");
      assert.equal(shedFile.headers.get("etag"), null, "no validator survives the shed");
      assert.deepEqual(JSON.parse(await shedFile.text()), {error: "outbound_budget_exhausted"});
    } finally {
      await nativeServer.stop();
      await hostServer.stop();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("the emitted velar/serve runtime carries each hardening contract", () => {
  const source = nodeModuleSources.get("velar/serve");
  assert.ok(source, "velar/serve must have a Node runtime source");
  for (const contract of [
    /if \(credentials && __velarServeCall\(__velarServeArrayIncludes, origins, \["\*"\]\)\) throw new __velarServeTypeError\("middleware\.cors cannot combine credentials with the '\*' origin wildcard"\);/u,
    /function __velarServeIsResponseAttempt\(value\) \{/u,
    /if \(matches > 1\) throw new HttpError\(400, \{error: "duplicate_cookie", parameter: name\}\);/u,
    /class __velarServeNativeNotFound extends __velarServeError \{\}/u,
    /function __velarServeUploadBasename\(filename\) \{/u,
    /class __velarServeOutboundBudgetError extends HttpError \{/u,
    /async function __velarServeUploadTarget\(path, root\) \{/u,
    /save: async \(path, root\) => \{/u,
  ]) assert.match(source, contract);

  // Budget exhaustion is a load condition, so no reserve may leave a bare
  // RangeError for the generic 500 fallback to pick up.
  assert.match(source, /if \(__velarServeOutboundBytes \+ bytes > __velarServeMaxOutboundBytes\) throw new __velarServeOutboundBudgetError\(\);/u);
  assert.doesNotMatch(source, /aggregate outbound byte budget is exhausted/u);
  assert.match(source, /if \(error instanceof __velarServeOutboundBudgetError && await __velarServeShedOutbound\(value\.handle\)\) return;/u, "the isolated-host transport answers the budget error itself");
  assert.match(source, /if \(error instanceof __velarServeOutboundBudgetError && !response\.headersSent\) \{\n\s*__velarServeNativeResetHeaders\(response\);\n\s*response\.statusCode = 503;\n\s*response\.setHeader\("retry-after", "1"\);/u, "the native transport answers the budget error itself, from an empty header set");
  assert.match(source, /super\(503, \{error: "outbound_budget_exhausted"\}, new __velarServeMap\(\[\["retry-after", "1"\]\]\)\);/u);

  const attempts = source.match(/if \(__velarServeIsResponseAttempt\(value\)\) return __velarServeResponse\(value\);/gu) ?? [];
  assert.equal(attempts.length, 2, "both the route and the @notFound wrapper discriminate a response attempt structurally");

  // The process cap counts detached continuations only, so the counter is
  // raised exactly where a continuation is created — and the cap is re-read
  // there, because admission alone cannot bound a burst that expires together.
  const increments = source.match(/__velarServeActiveTimeouts \+= 1;/gu) ?? [];
  assert.equal(increments.length, 1);
  assert.match(source, /if \(__velarServeActiveTimeouts >= __velarServeMaxActiveTimeouts\) \{\n\s*try \{ await pending; \}\n\s*catch \(error\) \{ __velarServeReportFailure\(error\); \}\n\s*return \{status: 504, json: \{error: "request_timeout"\}\};\n\s*\}\n\s*__velarServeActiveTimeouts \+= 1;\n\s*__velarServeActiveBackgroundTasks \+= 1;/u);
  assert.doesNotMatch(source, /if \(!detached\) __velarServeActiveTimeouts -= 1;/u, "an attached request no longer occupies a detached-continuation slot");

  assert.match(source, /if \(!info\.isFile\(\)\) throw new __velarServeNativeNotFound/u, "a directory is reported as missing, not as an oversize file");
  assert.match(source, /throw new __velarServeNativeNotFound\("fileResponse root does not name a directory"\)/u, "a static root that does not exist is a miss, not a server failure");
  assert.match(source, /return path === "\.\." \|\| path\.startsWith\("\.\.\/"\) \|\| path\.startsWith\("\.\.\\\\"\) \|\| operations\.isAbsolute\(path\);/u, "containment tests whole `..` segments on both separators");
  assert.match(source, /if \(info\.size > 64 \* 1024 \* 1024\) throw new __velarServeRangeError\("fileResponse file exceeds 64 MiB"\);/u);
  assert.match(source, /if \(error instanceof __velarServeNativeNotFound && !response\.headersSent\) \{/u);
  assert.match(source, /__velarServeUploadValue\(name, base, contentType, part, uploadStates\)/u, "only the reduced base name reaches Upload.filename");
});
