import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { nodeModuleSources, velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";

/**
 * SV-I4 and SR-U2: the referees that judge a route table agree with `openapi()`.
 *
 * A WebSocket upgrade is an HTTP GET on the wire, so a `@get` route and a
 * `@websocket` route at one path are one address with two owners. `openapi()`
 * has always refused to describe that pair, while the compiler and the assembly
 * check let it through: a server that cannot be documented could be started, and
 * only the attempt to document it said so. A declarative `@websocket` route owns
 * its own path for the same reason, so `listen({path})` beside one is refused —
 * and the refusal now names the path it refused.
 */

/** A whole-project compile, so `velar/websocket`'s connection type resolves. */
async function compileNode(source: string) {
  const path = join(tmpdir(), "velar-serve-referee.vel");
  const project = await compileProject(path, new Map([[path, source.trimStart()]]), { extensions: [velarNodeCompilerExtension] });
  return project.modules[0]!.result;
}

const CLASH = `
import {WebSocketConnection} from "velar/websocket"

server clash:
    @get same(p"/w") => {ok: true}
    @websocket dup(p"/w", connection: WebSocketConnection):
        await connection.close()
`;

test("a GET route and a @websocket route at one path are refused where the route table is judged", async () => {
  const clash = await compileNode(CLASH);
  const refusal = clash.diagnostics.find((item) => /WebSocket upgrade cannot share one documented path/u.test(item.message));
  assert.ok(refusal, JSON.stringify(clash.diagnostics));
  assert.equal(refusal.code, "VEL4001");
  assert.equal(
    refusal.message,
    "Route 'GET /w' and 'WEBSOCKET /w' share the path '/w'; an HTTP GET and a WebSocket upgrade cannot share one documented path",
  );

  // Declaration order does not change the verdict.
  const reversed = await compileNode(`
import {WebSocketConnection} from "velar/websocket"

server clash:
    @websocket dup(p"/w", connection: WebSocketConnection):
        await connection.close()
    @get same(p"/w") => {ok: true}
`);
  assert.ok(reversed.diagnostics.some((item) => /WebSocket upgrade cannot share one documented path/u.test(item.message)), JSON.stringify(reversed.diagnostics));

  // A legal WebSocket route beside HTTP routes at other paths is untouched.
  const legal = await compileNode(`
import {WebSocketConnection} from "velar/websocket"

server realtime:
    @get health(p"/health") => {ok: true}
    @post publish(p"/w") => {ok: true}
    @websocket session(p"/w", connection: WebSocketConnection):
        await connection.close()
`);
  assert.deepEqual(legal.diagnostics, []);
});

test("a composed GET route and @websocket route at one path are refused with both origins named", async () => {
  const composed = await compileNode(`
import {WebSocketConnection} from "velar/websocket"

server httpRoutes:
    @get same(p"/w") => {ok: true}

server socketRoutes:
    @websocket dup(p"/w", connection: WebSocketConnection):
        await connection.close()

server api:
    ...httpRoutes
    ...socketRoutes
`);
  const refusal = composed.diagnostics.find((item) => /WebSocket upgrade cannot share one documented path/u.test(item.message));
  assert.ok(refusal, JSON.stringify(composed.diagnostics));
  assert.match(refusal.message, /composed in from 'httpRoutes'/u);
  assert.match(refusal.message, /composed in from 'socketRoutes'/u);
});

test("the listener's legacy path names the path it refuses beside declarative @websocket routes", () => {
  // SR-U2: the refusal lives where the finished route table is judged — at
  // assembly — and says which path it refused, so the author can see what to
  // remove. A compile-time referee for this shape needs an AST walk the
  // compiler does not publish to an extension yet.
  const source = nodeModuleSources.get("velar/websocket") ?? "";
  assert.match(
    source,
    /throw new TypeError\("listen path '" \+ path \+ "' is unavailable when the ServeApp declares @websocket routes; those routes own their own paths"\)/u,
  );
});
