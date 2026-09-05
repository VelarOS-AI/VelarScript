import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { routePattern, runtime, type ServeCompilerBridge } from "./node-runtime-harness.ts";

/**
 * SV-D1 and SV-I1: what a framework refusal looks like on the wire.
 *
 * The framework publishes one shape for its own refusals — an RFC 9457 problem
 * document with `application/problem+json` — and `openapi()` documents that
 * shape. Two things broke that promise: copying a response for a header
 * middleware or a background task dropped the media type from the `json`
 * branch, and the refusals the transport made before a handler ran answered
 * with one line of `text/plain` instead.
 */

type ServeRuntime = {
  readonly ServeApp: object;
  /** The built-in middleware factories, each returning one middleware function. */
  readonly middleware: {
    requestId(): unknown;
    securityHeaders(): unknown;
    cors(origins: readonly string[]): unknown;
    timeout(milliseconds: number): unknown;
    errors(handle: (error: unknown, request: unknown) => Promise<unknown>): unknown;
  };
  bodyLimit(app: unknown, maxBytes: number): unknown;
  staticFiles(path: string, root: string, fallback?: string | null): unknown;
  text(value: string, status?: number, contentType?: string, headers?: unknown): unknown;
  use(app: unknown, middleware: unknown): unknown;
  serve(app: unknown, port: number): Promise<{ readonly port: number; stop(): Promise<null> }>;
  HttpProblem: new (options: Record<string, unknown>) => Error;
};

type Bridge = ServeCompilerBridge & {
  createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>, metadata?: Record<string, unknown>): unknown;
  createApp(name: string, items: readonly unknown[]): unknown;
};

async function serveRuntime(): Promise<{ readonly module: ServeRuntime; readonly bridge: Bridge }> {
  const module = await runtime<ServeRuntime>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(module.ServeApp, "__velarCompilerBridge")?.value as Bridge;
  assert.ok(bridge, "velar/serve publishes its compiler bridge");
  return { module, bridge };
}

/** One request written on a bare socket, so a shape `fetch` refuses to send can still be sent. */
function rawRequest(port: number, request: string): Promise<string> {
  return new Promise((resolveRaw, rejectRaw) => {
    let received = "";
    const socket = createConnection({ host: "127.0.0.1", port }, () => socket.write(request));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => { received += chunk; });
    socket.on("error", rejectRaw);
    socket.on("close", () => resolveRaw(received));
  });
}

test("a problem document keeps application/problem+json through header middleware and a timeout", async () => {
  const { module, bridge } = await serveRuntime();
  const ok = bridge.createRoute("GET", routePattern(bridge, "/ok"), [], async () => ({ ok: true }));
  const conflict = bridge.createRoute("GET", routePattern(bridge, "/conflict"), [], async () => {
    throw new module.HttpProblem({ status: 409, code: "a.conflict", title: "Conflict" });
  });
  const csv = bridge.createRoute("GET", routePattern(bridge, "/csv"), [], async () => module.text("a,b\n", 200, "text/csv; charset=utf-8"));
  // Slower than the timeout, and still bounded: a handler that never settles
  // would hold the shutdown drain open for its whole deadline.
  const hang = bridge.createRoute("GET", routePattern(bridge, "/hang"), [], async () => {
    await new Promise((resolveHandler) => setTimeout(resolveHandler, 600));
    return { ok: true };
  });
  const inner = bridge.createApp("inner", [ok, conflict, csv, hang]);
  const app = module.use(inner, [module.middleware.requestId(), module.middleware.securityHeaders(), module.middleware.timeout(200)]);
  const server = await module.serve(app, 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const notAllowed = await fetch(`${base}/ok`, { method: "POST" });
    assert.equal(notAllowed.status, 405);
    assert.equal(notAllowed.headers.get("content-type"), "application/problem+json; charset=utf-8");
    assert.equal(notAllowed.headers.get("x-content-type-options"), "nosniff");
    assert.ok(notAllowed.headers.get("x-request-id"));

    const problem = await fetch(`${base}/conflict`);
    assert.equal(problem.status, 409);
    assert.equal(problem.headers.get("content-type"), "application/problem+json; charset=utf-8");

    // `middleware.timeout`'s 504 leaves through the background-task copy, the
    // second place the dropped media type used to surface.
    const timedOut = await fetch(`${base}/hang`);
    assert.equal(timedOut.status, 504);
    assert.equal(timedOut.headers.get("content-type"), "application/problem+json; charset=utf-8");
    assert.equal((await timedOut.json() as { code: string }).code, "request.timeout");

    // The text branch is unchanged: an explicit contentType still survives.
    const csvResponse = await fetch(`${base}/csv`);
    assert.equal(csvResponse.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(await csvResponse.text(), "a,b\n");
  } finally {
    await server.stop();
  }
});

test("every framework refusal made after the request line is one problem document", async () => {
  const { module, bridge } = await serveRuntime();
  const assets = await mkdtemp(join(tmpdir(), "velar-serve-problem-assets-"));
  await writeFile(join(assets, "a.txt"), "hello file\n", "utf8");
  const create = bridge.createRoute("POST", routePattern(bridge, "/create"), [
    { name: "input", source: "body", kind: "data", required: true, check: () => true },
  ], async (_path: unknown, input: unknown) => input);
  const app = bridge.createApp("api", [
    module.bodyLimit(bridge.createApp("limited", [create]), 16),
    module.staticFiles("/assets", assets),
  ]);
  const server = await module.serve(app, 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const problemOf = async (response: Response): Promise<Record<string, unknown>> => {
      assert.equal(response.headers.get("content-type"), "application/problem+json; charset=utf-8");
      return await response.json() as Record<string, unknown>;
    };

    const tooLarge = await fetch(`${base}/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(64) }) });
    assert.equal(tooLarge.status, 413);
    assert.equal((await problemOf(tooLarge)).code, "request.request.too.large");

    const unsupported = await fetch(`${base}/create`, { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" });
    assert.equal(unsupported.status, 415);
    assert.equal((await problemOf(unsupported)).code, "request.unsupported.media.type");

    const missingFile = await fetch(`${base}/assets/missing.txt`);
    assert.equal(missingFile.status, 404);
    assert.deepEqual(await problemOf(missingFile), { type: "about:blank", title: "Not found", status: 404, code: "static.not_found", instance: "/assets/missing.txt" });

    const badRange = await fetch(`${base}/assets/a.txt`, { headers: { range: "bytes=500-600" } });
    assert.equal(badRange.status, 416);
    assert.equal(badRange.headers.get("content-range"), "bytes */11");
    assert.equal((await problemOf(badRange)).code, "static.range_not_satisfiable");

    // A legal static read is untouched.
    const file = await fetch(`${base}/assets/a.txt`);
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "hello file\n");

    // The five malformed paths are refused before routing, and each of them is
    // now the same problem document rather than the words "Bad request".
    for (const target of ["/assets/../a.txt", "/assets%2Fa.txt", "/assets/a%00.txt", "/assets/a%zz.txt", "/assets/a%FF.txt"]) {
      const raw = await rawRequest(server.port, `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      assert.match(raw, /^HTTP\/1\.1 400 Bad Request\r\n/u, `${target} is refused before routing`);
      assert.match(raw, /Content-Type: application\/problem\+json; charset=utf-8/u, `${target}: ${raw}`);
      assert.match(raw, /"code":"request\.invalid\.path"/u, `${target}: ${raw}`);
    }

    // A declared Content-Length over the transport budget is a request too.
    const declared = await rawRequest(server.port, "POST /create HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 2147483648\r\nConnection: close\r\n\r\n");
    assert.match(declared, /^HTTP\/1\.1 413 Payload Too Large\r\n/u);
    assert.match(declared, /Content-Type: application\/problem\+json; charset=utf-8/u);
    assert.match(declared, /"code":"request\.request\.too\.large","instance":"\/create"/u, declared);

    // The other side of the boundary: a header block that never became a
    // request is refused by the transport itself and is not a problem document.
    const folded = await rawRequest(server.port, "GET /assets/a.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Folded: one\r\n two\r\nConnection: close\r\n\r\n");
    assert.match(folded, /^HTTP\/1\.1 4\d\d /u, folded.slice(0, 200));
    assert.doesNotMatch(folded, /application\/problem\+json/u, folded.slice(0, 400));
    const oversizedTarget = await rawRequest(server.port, `GET /${"x".repeat(70_000)} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    assert.match(oversizedTarget, /^HTTP\/1\.1 4\d\d /u, oversizedTarget.slice(0, 200));
    assert.doesNotMatch(oversizedTarget, /application\/problem\+json/u, oversizedTarget.slice(0, 400));
  } finally {
    await server.stop();
  }
});

test("a path parameter matches a non-empty segment, so an empty one is a 404", async () => {
  // SV-U4: '/n/' matched '/n/{id:number}' with an empty capture and answered
  // 422 about an `id` the request never supplied. A parameter names a segment,
  // and an empty segment is not one, so the route simply does not match.
  const { module, bridge } = await serveRuntime();
  const numbered = bridge.createRoute("GET", routePattern(bridge, "/n/{id:number}"), [], async (path: { params: { id: number } }) => ({ id: path.params.id }));
  const server = await module.serve(bridge.createApp("numbers", [numbered]), 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const found = await fetch(`${base}/n/5`);
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), { id: 5 });

    const empty = await fetch(`${base}/n/`);
    assert.equal(empty.status, 404, "an empty segment supplies no id");
    assert.equal((await empty.json() as { code: string }).code, "route.not_found");

    // A present segment that is not a number is still the 422 it always was.
    const invalid = await fetch(`${base}/n/x`);
    assert.equal(invalid.status, 422);
    const problem = await invalid.json() as { code: string; parameter: string };
    assert.equal(problem.code, "request.invalid.request");
    assert.equal(problem.parameter, "id");
  } finally {
    await server.stop();
  }
});
