import assert from "node:assert/strict";
import test from "node:test";
import { compileServer } from "../support/server-compile.ts";

/**
 * D115 §三 — the Server-owned half of the 1,012-line
 * `tests/node/node-server-framework.test.ts`, moved verbatim. These tests
 * compile under `@velarscript/server`'s own compiler and project extensions
 * and assert on `velar/server`'s roster, so the package they hold is Server
 * rather than Node; the D114 T3 note that filing the *whole* file here would
 * be archiving by convenience is why only these came.
 *
 * The subject is the contract a Server route declares: the framework-owned
 * `@websocket` connection, the uniqueness of a named operation after
 * composition, and the OpenAPI envelope `@response` settles on.
 */

test("@websocket declares one framework-owned connection and shares RoutePattern projection", async () => {
  const result = await compileServer(`
import {WebSocketConnection} from "velar/websocket"

server realtime:
    @websocket worldRealtime(p"/worlds/{worldId:string}/realtime", connection: WebSocketConnection):
        print(worldId)
        await connection.close()
`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCreateServeWebSocket\(/u);
  assert.match(result.code ?? "", /source:"connection",kind:"connection"/u);
  assert.match(result.code ?? "", /operationId:"worldRealtime"/u);
  assert.match(result.code ?? "", /async \(\{params:\{worldId\},query:\{\}\}, connection\)/u);

  const missing = await compileServer(`server realtime:\n    @websocket(p"/realtime"):\n        pass\n`);
  assert.ok(missing.diagnostics.some((item) => /requires exactly one WebSocketConnection/u.test(item.message)));

  const body = await compileServer(`
type Payload:
    value: string
server realtime:
    @websocket(p"/realtime", payload: Payload):
        pass
`);
  assert.ok(body.diagnostics.some((item) => /must be WebSocketConnection, Request, or an explicit input descriptor/u.test(item.message)));
});

test("named HTTP and WebSocket operations remain unique after server composition", async () => {
  const result = await compileServer(`
server base:
    @get worldBootstrap(p"/worlds/{worldId:string}") => {id: worldId}

server duplicate:
    @post worldBootstrap(p"/worlds", input: body<string>) => input

server api:
    ...base
    ...duplicate
`);
  assert.ok(result.diagnostics.some((item) => /Operation 'worldBootstrap'.*must be unique after server composition/u.test(item.message)));

  const valid = await compileServer(`
server api:
    @get worldBootstrap(p"/worlds/{worldId:string}") => {id: worldId}
`);
  assert.deepEqual(valid.diagnostics, []);
  assert.match(valid.code ?? "", /operationId:"worldBootstrap"/u);
});

test("@response emits its final OpenAPI envelope contract", async () => {
  const result = await compileServer(`
import {HttpOutcome} from "velar/serve"

type Envelope:
    ok: bool

server api:
    @get(p"/health" as path) => {ready: true}
    @response(outcome: HttpOutcome) -> Envelope: return {ok: outcome.ok}
`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(
    result.code ?? "",
    /__velarCreateServeResponse\([\s\S]*?responseSchema:\{"type":"object","properties":\{"ok":\{"type":"boolean"\}\},"required":\["ok"\],"additionalProperties":false\}/u,
  );
});
