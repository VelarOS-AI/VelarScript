import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { nodeModuleSources } from "../../packages/node/src/compiler.ts";
import { materializeNodeRuntimeDependencies, routePattern } from "../support/node-runtime.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is `velar/websocket`: the single ServeApp lifecycle `listen`
 * composes, the globally bounded queues it keeps, and the matching, decoded
 * captures and handler lifetime a declarative `@websocket` route owns.
 */

test("Node WebSocket listen composes one ServeApp lifecycle and keeps queues globally bounded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-websocket-compose-"));
  try {
    await materializeNodeRuntimeDependencies(directory, "velar/websocket");
    const require = createRequire(import.meta.url);
    await cp(resolve(require.resolve("ws/package.json"), ".."), join(directory, "node_modules", "ws"), {recursive: true});
    const websocketSource = nodeModuleSources.get("velar/websocket");
    assert.ok(websocketSource);
    const websocketPath = join(directory, "websocket.mjs");
    await writeFile(websocketPath, websocketSource, "utf8");
    const serve = await import(pathToFileURL(join(directory, "node_modules", "velar", "serve.js")).href) as {
      ServeApp: object;
      lifecycle(app: unknown, startup: () => Promise<null>, shutdown: () => Promise<null>): unknown;
    };
    const websocket = await import(`${pathToFileURL(websocketPath).href}?compose=${Date.now()}`) as {
      listen(options: Record<string, unknown>): Promise<{port: number; next(): Promise<{origin: string | null; send(value: string): Promise<null>; next(): Promise<string | Uint8Array | null>; closeInfo(): Promise<{code: number; reason: string}>; close(code?: number, reason?: string): Promise<null>} | null>; stop(): Promise<null>}>;
      connect(url: string): Promise<{origin: string | null; send(value: string): Promise<null>; next(): Promise<string | Uint8Array | null>; closeInfo(): Promise<{code: number; reason: string}>; close(code?: number, reason?: string): Promise<null>}>;
    };
    const bridge = Object.getOwnPropertyDescriptor(serve.ServeApp, "__velarCompilerBridge")?.value as {
      createPattern(source: Record<string, unknown>): unknown;
      createRoute(method: string, path: unknown, parameters: readonly unknown[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
      createApp(name: string, items: readonly unknown[]): unknown;
    };
    let starts = 0;
    let stops = 0;
    let markWaitEntered = (): void => {};
    const waitEntered = new Promise<void>((resolveEntered) => { markWaitEntered = resolveEntered; });
    let cancellationReason: string | null = null;
    const health = bridge.createRoute("GET", routePattern(bridge, "/health"), [], async () => ({ok: true}));
    const echo = bridge.createRoute("POST", routePattern(bridge, "/echo"), [{name: "request", source: "request", kind: "request", required: true}], async (_path: unknown, request: {text(): Promise<string>}) => ({body: await request.text()}));
    const wait = bridge.createRoute("GET", routePattern(bridge, "/wait"), [{name: "request", source: "request", kind: "request", required: true}], async (_path: unknown, request: {cancellation: {cancelled: boolean; reason: string | null}}) => {
      markWaitEntered();
      while (!request.cancellation.cancelled) await new Promise<void>((resolveWait) => setTimeout(resolveWait, 2));
      cancellationReason = request.cancellation.reason;
      return {stopped: true};
    });
    const app = serve.lifecycle(bridge.createApp("socket", [health, echo, wait]), async () => { starts += 1; return null; }, async () => { stops += 1; return null; });
    await assert.rejects(
      websocket.listen({port: 0, origins: ["https://client.test/path"]}),
      /must not contain paths/u,
    );
    await assert.rejects(
      websocket.listen({port: 0, host: ""}),
      /host must be bounded non-empty text/u,
    );
    await assert.rejects(
      websocket.listen({port: 0, host: "x".repeat(256)}),
      /host must be bounded non-empty text/u,
    );
    await assert.rejects(
      websocket.listen({port: 0, host: "127.0.0.1\0.invalid"}),
      /host must be bounded non-empty text/u,
    );
    const defaultServer = await websocket.listen({port: 0, host: "127.0.0.1", path: "/default"});
    try {
      assert.equal(await rejectedWebSocketStatus(`ws://127.0.0.1:${defaultServer.port}/default`, "https://client.test"), 403, "browser Origins must be denied by default");
      const serviceClient = await websocket.connect(`ws://127.0.0.1:${defaultServer.port}/default`);
      const serviceConnection = await defaultServer.next();
      assert.ok(serviceConnection, "a non-browser client without Origin remains available by default");
      assert.equal(serviceConnection.origin, null, "a client that sent no Origin reads back null");
      assert.equal(serviceClient.origin, null, "an outbound connection was never upgraded from an Origin");
      await serviceClient.close();
    } finally {
      await defaultServer.stop();
    }
    const wildcardServer = await websocket.listen({port: 0, host: "127.0.0.1", path: "/wildcard", origins: ["*"]});
    try {
      const wildcardClient = await openedWebSocket(`ws://127.0.0.1:${wildcardServer.port}/wildcard`, "https://unlisted.test");
      const wildcardConnection = await wildcardServer.next();
      assert.ok(wildcardConnection, "the explicit wildcard policy accepts browser Origins");
      assert.equal(wildcardConnection.origin, "https://unlisted.test", "an accepted connection reads back the Origin it was upgraded from");
      wildcardClient.close();
      await wildcardConnection.close();
      // D90 fr-4: the field means "the origin this client was upgraded from, or
      // null", so every value has to land on the side the sentence claims. A
      // scheme is case-insensitive, so an uppercase one is an origin and must
      // canonicalize rather than read as "sent none"; a port that is the
      // scheme's default is not part of an origin; a single header carrying two
      // origins is not an origin at all and must read null rather than the
      // attacker-chosen text URL parsing leaves in the host; and the opaque
      // `null` a sandboxed document sends is not an origin either.
      for (const [sent, expected] of [
        ["HTTPS://Unlisted.Test", "https://unlisted.test"],
        ["https://unlisted.test:443", "https://unlisted.test"],
        ["https://unlisted.test,https://evil.test", null],
        ["null", null],
      ] as const) {
        const client = await openedWebSocket(`ws://127.0.0.1:${wildcardServer.port}/wildcard`, sent);
        const connection = await wildcardServer.next();
        assert.ok(connection, `the wildcard policy accepts Origin ${sent}`);
        assert.equal(connection.origin, expected, `Origin ${sent} reads back ${String(expected)}`);
        client.close();
        await connection.close();
      }
    } finally {
      await wildcardServer.stop();
    }
    const server = await websocket.listen({port: 0, host: "127.0.0.1", path: "/ws", http: app, origins: ["https://client.test"], maxBodyBytes: 4, maxQueuedBytes: 1024, maxPendingSendBytes: 1024});
    let pendingAfterPeerClose: Promise<unknown> | null = null;
    try {
      assert.equal(starts, 1);
      assert.deepEqual(await (await fetch(`http://127.0.0.1:${server.port}/health`)).json(), {ok: true});
      assert.deepEqual(await (await fetch(`http://127.0.0.1:${server.port}/echo`, {method: "POST", body: "four"})).json(), {body: "four"});
      assert.equal((await fetch(`http://127.0.0.1:${server.port}/echo`, {method: "POST", body: "oversized"})).status, 413);
      assert.equal(await rejectedWebSocketStatus(`ws://127.0.0.1:${server.port}/ws`, "https://untrusted.test"), 403);
      const browserClient = await openedWebSocket(`ws://127.0.0.1:${server.port}/ws`, "https://client.test");
      const browserAccepted = await server.next();
      assert.ok(browserAccepted, "the exact allowed Origin must reach the connection queue");
      assert.equal(browserAccepted.origin, "https://client.test");
      browserClient.close();
      await browserAccepted.close();
      const client = await websocket.connect(`ws://127.0.0.1:${server.port}/ws`);
      const accepted = await server.next();
      assert.ok(accepted);
      await client.send("hello");
      assert.equal(await accepted.next(), "hello");
      await accepted.send("world");
      assert.equal(await client.next(), "world");
      await client.close(1000, "finished");
      assert.deepEqual(await client.closeInfo(), {code: 1000, reason: "finished"});
      assert.deepEqual(await accepted.closeInfo(), {code: 1000, reason: "finished"});
      const abandoned = await websocket.connect(`ws://127.0.0.1:${server.port}/ws`);
      await abandoned.close();
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
      pendingAfterPeerClose = server.next();
      const waitingResponse = fetch(`http://127.0.0.1:${server.port}/wait`);
      await waitEntered;
      await server.stop();
      assert.equal(cancellationReason, "Server is stopping", "shared-port stop must cancel HTTP work before waiting for the transport to close");
      assert.deepEqual(await (await waitingResponse).json(), {stopped: true});
    } finally {
      await Promise.all([server.stop(), server.stop()]);
    }
    assert.equal(await pendingAfterPeerClose, null, "a peer that closes before accept must not leave a stale queued connection");
    assert.equal(stops, 1, "concurrent WebSocket stop calls join one application shutdown");
    for (const contract of [
      /__velarWsAggregateByteLimit = 128 \* 1024 \* 1024/u,
      /__velarWsAggregateQueuedMessageLimit = 65536/u,
      /__velarWsAggregatePendingSendLimit = 8192/u,
      /__velarWsActiveConnectionLimit = 4096/u,
      /__velarWsPendingConnectionLimit = 4096/u,
      /state\.queue\.length = 0/u,
      /state\.stopPromise/u,
      /__velarWsReleasePendingSends/u,
      /function __velarWsRequestOrigin\(request\)/u,
      /__velarWsWrap\(socket, limits, __velarWsRequestOrigin\(request\)\)/u,
    ]) assert.match(websocketSource, contract);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("declarative @websocket routes own matching, decoded captures, and handler lifetime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-websocket-routes-"));
  try {
    await materializeNodeRuntimeDependencies(directory, "velar/websocket");
    const require = createRequire(import.meta.url);
    await cp(resolve(require.resolve("ws/package.json"), ".."), join(directory, "node_modules", "ws"), {recursive: true});
    const websocketSource = nodeModuleSources.get("velar/websocket");
    assert.ok(websocketSource);
    const websocketPath = join(directory, "websocket.mjs");
    await writeFile(websocketPath, websocketSource, "utf8");
    const serve = await import(pathToFileURL(join(directory, "node_modules", "velar", "serve.js")).href) as {ServeApp: object};
    const websocket = await import(`${pathToFileURL(websocketPath).href}?routes=${Date.now()}`) as {
      listen(options: Record<string, unknown>): Promise<{port: number; next(): Promise<unknown>; stop(): Promise<null>}>;
      connect(url: string): Promise<{send(value: string): Promise<null>; next(): Promise<string | Uint8Array | null>; closeInfo(): Promise<{code: number; reason: string}>; close(code?: number, reason?: string): Promise<null>}>;
    };
    const bridge = Object.getOwnPropertyDescriptor(serve.ServeApp, "__velarCompilerBridge")?.value as {
      createPattern(source: Record<string, unknown>): unknown;
      createWebSocket(path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
      createApp(name: string, items: readonly unknown[]): unknown;
    };
    const pattern = routePattern(bridge, "/worlds/{worldId:string}/realtime", [{name: "details", kind: "bool", optional: true}]);
    const route = bridge.createWebSocket(pattern, [
      {name: "connection", source: "connection", kind: "connection", required: true},
    ], async (match: {params: {worldId: string}; query: {details?: boolean}}, connection: {next(): Promise<string | Uint8Array | null>; send(value: string): Promise<null>; close(): Promise<null>}) => {
      const message = await connection.next();
      await connection.send(`${match.params.worldId}:${String(match.query.details ?? false)}:${String(message)}`);
      await connection.close();
      return null;
    });
    const requiredPattern = routePattern(bridge, "/required", [{name: "details", kind: "bool", optional: false}]);
    const requiredRoute = bridge.createWebSocket(requiredPattern, [
      {name: "connection", source: "connection", kind: "connection", required: true},
    ], async (_match: unknown, connection: {close(): Promise<null>}) => {
      await connection.close();
      return null;
    });
    let resolveCancellation: ((reason: string | null) => void) | null = null;
    const cancellationObserved = new Promise<string | null>(resolveValue => { resolveCancellation = resolveValue; });
    const cancellationPattern = routePattern(bridge, "/cancel", []);
    const cancellationRoute = bridge.createWebSocket(cancellationPattern, [
      {name: "request", source: "request", kind: "request", required: true},
      {name: "connection", source: "connection", kind: "connection", required: true},
    ], async (_match: unknown, request: {cancellation: {cancelled: boolean; reason: string | null}}, _connection: unknown) => {
      while (!request.cancellation.cancelled) await new Promise(resolveValue => setTimeout(resolveValue, 1));
      resolveCancellation?.(request.cancellation.reason);
      return null;
    });
    const app = bridge.createApp("realtime", [route, requiredRoute, cancellationRoute]);
    await assert.rejects(
      websocket.listen({port: 0, host: "127.0.0.1", http: app, path: "/legacy", origins: ["*"]}),
      /listen path '\/legacy' is unavailable when the ServeApp declares @websocket routes; those routes own their own paths/u,
    );
    const server = await websocket.listen({port: 0, host: "127.0.0.1", http: app, origins: ["*"]});
    try {
      await assert.rejects(server.next(), /owned by @websocket routes/u);
      assert.equal(await rejectedWebSocketStatus(`ws://127.0.0.1:${server.port}/missing`, "https://client.test"), 404);
      assert.equal(await rejectedWebSocketStatus(`ws://127.0.0.1:${server.port}/required`, "https://client.test"), 422);
      const client = await websocket.connect(`ws://127.0.0.1:${server.port}/worlds/demo/realtime?details=true`);
      await client.send("hello");
      assert.equal(await client.next(), "demo:true:hello");
      assert.equal(await client.next(), null);
      const cancellationClient = await websocket.connect(`ws://127.0.0.1:${server.port}/cancel`);
      await cancellationClient.close();
      assert.equal(await cancellationObserved, "WebSocket connection closed");
    } finally {
      await server.stop();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

function rejectedWebSocketStatus(url: string, origin: string): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const socket = new WebSocket(url, {origin});
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => finish(() => rejectStatus(new Error("WebSocket rejection did not settle"))), 5_000);
    socket.once("unexpected-response", (_request, response) => finish(() => {
      response.resume();
      resolveStatus(response.statusCode ?? 0);
    }));
    socket.once("open", () => finish(() => {
      socket.close();
      rejectStatus(new Error("WebSocket Origin was unexpectedly accepted"));
    }));
    socket.once("error", error => finish(() => rejectStatus(error)));
  });
}

function openedWebSocket(url: string, origin: string): Promise<WebSocket> {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(url, {origin});
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => finish(() => rejectSocket(new Error("WebSocket connection did not open"))), 5_000);
    socket.once("open", () => finish(() => resolveSocket(socket)));
    socket.once("unexpected-response", (_request, response) => finish(() => {
      response.resume();
      rejectSocket(new Error(`WebSocket handshake returned ${response.statusCode ?? 0}`));
    }));
    socket.once("error", error => finish(() => rejectSocket(error)));
  });
}
