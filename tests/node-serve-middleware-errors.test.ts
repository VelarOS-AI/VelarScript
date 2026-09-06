import assert from "node:assert/strict";
import { createConnection } from "node:net";
import test from "node:test";
import { routePattern, runtime, type ServeCompilerBridge } from "./node-runtime-harness.ts";
import { runVelarProject } from "./velar-project-harness.ts";

/**
 * SV-D4/SV-U5 and SV-I3: which endings leave through the application's
 * middleware, and which failures are the application's at all.
 *
 * A thrown `HttpProblem` used to unwind straight out of the middleware chain,
 * so the half of every middleware that shapes a response never ran: `nosniff`
 * and `access-control-allow-origin` were present on a 200 and absent on the 409
 * and the 500 from the same route, which is exactly when a browser needs them.
 * The framework's own 404 for an unclaimed path did not enter middleware at all.
 * Separately, a client that hung up mid-request was written to stderr in the
 * words of a handler that failed, so a stopped download and a bug in a route
 * were the same line.
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
  use(app: unknown, middleware: unknown): unknown;
  serve(app: unknown, port: number): Promise<{ readonly port: number; stop(): Promise<null> }>;
  HttpProblem: new (options: Record<string, unknown>) => Error;
};

type Bridge = ServeCompilerBridge & {
  createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>, metadata?: Record<string, unknown>): unknown;
  createApp(name: string, items: readonly unknown[]): unknown;
};

test("a route's every ending carries the middleware's headers, and so does the framework 404", async () => {
  const module = await runtime<ServeRuntime>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(module.ServeApp, "__velarCompilerBridge")?.value as Bridge;
  const ok = bridge.createRoute("GET", routePattern(bridge, "/ok"), [], async () => ({ ok: true }));
  const conflict = bridge.createRoute("GET", routePattern(bridge, "/conflict"), [], async () => {
    throw new module.HttpProblem({ status: 409, reason: "a.conflict", title: "Conflict" });
  });
  const boom = bridge.createRoute("GET", routePattern(bridge, "/boom"), [], async () => { throw new Error("kaboom"); });
  const app = module.use(bridge.createApp("inner", [ok, conflict, boom]), [
    module.middleware.requestId(),
    module.middleware.securityHeaders(),
    module.middleware.cors(["https://client.test"]),
  ]);
  const server = await module.serve(app, 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const origin = { origin: "https://client.test" };
    const shaped = async (path: string, status: number): Promise<Response> => {
      const response = await fetch(`${base}${path}`, { headers: origin });
      assert.equal(response.status, status, path);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff", `${path} carries the security headers`);
      assert.equal(response.headers.get("access-control-allow-origin"), "https://client.test", `${path} is readable across origins`);
      assert.ok(response.headers.get("x-request-id"), `${path} carries the request id`);
      return response;
    };
    // The success response is unchanged; the two failures now match it.
    assert.deepEqual(await (await shaped("/ok", 200)).json(), { ok: true });
    assert.equal((await (await shaped("/conflict", 409)).json() as { code: string }).code, "a.conflict");
    assert.equal((await (await shaped("/boom", 500)).json() as { code: string }).code, "server.internal");
    // SV-U5: the framework's own 404, with no @notFound declared anywhere.
    assert.equal((await (await shaped("/nowhere", 404)).json() as { code: string }).code, "route.not_found");
  } finally {
    await server.stop();
  }
});

test("middleware.errors is offered the error a route ended with, and other middleware still shapes its answer", async () => {
  const module = await runtime<ServeRuntime>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(module.ServeApp, "__velarCompilerBridge")?.value as Bridge;
  const boom = bridge.createRoute("GET", routePattern(bridge, "/boom"), [], async () => { throw new Error("kaboom"); });
  const conflict = bridge.createRoute("GET", routePattern(bridge, "/conflict"), [], async () => {
    throw new module.HttpProblem({ status: 409, reason: "a.conflict", title: "Conflict" });
  });
  const ok = bridge.createRoute("GET", routePattern(bridge, "/ok"), [], async () => ({ ok: true }));
  const recovered: string[] = [];
  const app = module.use(bridge.createApp("inner", [boom, conflict, ok]), [
    module.middleware.securityHeaders(),
    module.middleware.errors(async (error: unknown) => {
      recovered.push(error instanceof Error ? error.message : String(error));
      return { status: 503, json: { recovered: true } };
    }),
  ]);
  const server = await module.serve(app, 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const unexpected = await fetch(`${base}/boom`);
    assert.equal(unexpected.status, 503);
    assert.deepEqual(await unexpected.json(), { recovered: true });
    assert.equal(unexpected.headers.get("x-content-type-options"), "nosniff");

    const problem = await fetch(`${base}/conflict`);
    assert.equal(problem.status, 503, "a thrown HttpProblem reaches the recovery handler too");
    assert.deepEqual(recovered, ["kaboom", "Conflict"]);

    const healthy = await fetch(`${base}/ok`);
    assert.equal(healthy.status, 200, "a success never reaches the recovery handler");
    assert.deepEqual(recovered.length, 2);
  } finally {
    await server.stop();
  }
});

/** Sends a request, waits, and drops the socket before the response arrives. */
function hangUp(port: number, path: string): Promise<void> {
  return new Promise((resolveHangUp) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      setTimeout(() => { socket.destroy(); resolveHangUp(); }, 120);
    });
    socket.on("error", () => resolveHangUp());
  });
}

test("a handler failure still reports as an unhandled server request", async () => {
  const run = await runVelarProject({
    "src/main.vel": `
import {http} from "velar/http"
import {serve} from "velar/serve"

export server app:
    @get boom(p"/boom"):
        throw Error("kaboom")

@main:
    const server = await serve(app, port=0)
    try:
        const value = await http.get(f"http://127.0.0.1:{server.port}/boom").text()
        print(f"boom: unexpected {value}")
    catch failure:
        print(f"boom: {failure.message}")
    await server.stop()
`.trimStart(),
  }, { prefix: "velar-serve-failure-" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^boom: HTTP 500 for http:\/\/127\.0\.0\.1:\d+\/boom$/mu, run.stdout);
  assert.match(run.stderr, /^Unhandled server request failed: kaboom$/mu, run.stderr);
  assert.doesNotMatch(run.stderr, /Client closed the connection/u, run.stderr);
});

test("hanging up mid-request reports the client, not the handler", async () => {
  // The serve runtime captures `console.error` when its module initializes —
  // a later replacement cannot redirect a report — so the collector is in place
  // before the module is imported.
  const reports: string[] = [];
  const consoleError = console.error;
  console.error = (...values: unknown[]): void => { reports.push(values.map((value) => String(value)).join(" ")); };
  let server: { readonly port: number; stop(): Promise<null> } | null = null;
  try {
    const module = await runtime<ServeRuntime>("velar/serve");
    const bridge = Object.getOwnPropertyDescriptor(module.ServeApp, "__velarCompilerBridge")?.value as Bridge;
    const slow = bridge.createRoute("GET", routePattern(bridge, "/slow"), [], async () => {
      await new Promise((resolveHandler) => setTimeout(resolveHandler, 400));
      return { ok: true };
    });
    server = await module.serve(bridge.createApp("slow", [slow]), 0);
    await hangUp(server.port, "/slow");
    await hangUp(server.port, "/slow");
    await new Promise((resolveWait) => setTimeout(resolveWait, 600));
  } finally {
    if (server) await server.stop();
    console.error = consoleError;
  }
  assert.equal(reports.length, 2, JSON.stringify(reports));
  for (const report of reports) {
    assert.equal(report, "Client closed the connection before the response completed GET /slow");
  }
});
