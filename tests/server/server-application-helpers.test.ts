import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { compileProject } from "../../packages/cli/src/project.ts";
import { nodeModuleInterfaces } from "@velarscript/node/compiler";
import { serverModuleInterfaces, velarCompilerExtension as velarServerCompilerExtension, velarProjectExtension as serverProjectExtension } from "@velarscript/server/compiler";
import { compileServer } from "../support/server-compile.ts";

/**
 * D115 §三 — the Server-owned half of the 1,012-line
 * `tests/node/node-server-framework.test.ts`, moved verbatim. These tests
 * compile under `@velarscript/server`'s own compiler and project extensions
 * and assert on `velar/server`'s roster, so the package they hold is Server
 * rather than Node; the D114 T3 note that filing the *whole* file here would
 * be archiving by convenience is why only these came.
 *
 * The subject is what `velar/server` publishes to an application:
 * `configuration`, `authenticate`, `database` and the realtime session, plus
 * the census rule that none of them exists without the Server extension.
 */

test("server configuration, authentication, and database helpers preserve checked application types", async () => {
  assert.deepEqual(serverProjectExtension.parse({configuration: "application.yml"}, "/service/velar.json"), {
    configuration: "application.yml",
  });
  assert.deepEqual(serverProjectExtension.parse({configuration: "config/server.json"}, "/service/velar.json"), {
    configuration: "config/server.json",
  });
  assert.throws(() => serverProjectExtension.parse(undefined, "/service/velar.json"), /'server' must be an object/u);
  assert.throws(() => serverProjectExtension.parse({port: 3000}, "/service/velar.json"), /unknown 'server' field 'port'/u);
  assert.throws(() => serverProjectExtension.parse({configuration: "../application.yml"}, "/service/velar.json"), /must stay inside the project root/u);
  assert.throws(() => serverProjectExtension.parse({configuration: "/etc/application.yml"}, "/service/velar.json"), /project-relative path/u);
  assert.throws(() => serverProjectExtension.parse({configuration: "config\\application.yml"}, "/service/velar.json"), /using '\/' separators/u);
  assert.throws(() => serverProjectExtension.parse({configuration: "application.toml"}, "/service/velar.json"), /must end in/u);
  const source = `
import {application, authenticate, configuration, database} from "velar/server"
import {input, run, security} from "velar/serve"

type ServerSettings:
    host: string
    port: number
    maxBodyBytes: number

type Settings:
    server: ServerSettings
    databasePath: string

type Connection:
    path: string
    close: () -> Promise<null>

type User:
    id: string

async def verifyToken(token: string) -> User?:
    if token == "valid":
        return {id: "user-1"}
    return null

server routes:
    @get(p"/health" as path) => {ok: true}

const settings = await configuration(Settings)
const connection = database(
    connect=async () => {path: settings.databasePath, close: async () => null},
    disconnect=async value => await value.close(),
)
const currentUser = authenticate(security.bearer(), verifyToken)

server app:
    ...routes
    @get(p"/database" as path, value=input.dependency(connection)) => {path: value.path}
    @get(p"/me" as path, user=input.dependency(currentUser)) => {id: user.id}

@main:
    const server = await application(app)
    await run(server)
`.trimStart();
  const path = join(tmpdir(), "velar-server-framework-helpers.vel");
  const project = await compileProject(path, new Map([[path, source]]), {extensions: [velarServerCompilerExtension]});
  const result = project.modules[0]!.result;
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /configuration\(Settings\)/u);
  assert.match(result.code ?? "", /authenticate\(security\.bearer\(\), verifyToken\)/u);
  assert.match(result.code ?? "", /database\(/u);
  assert.match(result.code ?? "", /application\(app\)/u);
});

test("server realtime sessions infer one typed codec, peer, and lifecycle", async () => {
  const result = await compileServer(`
import {Bytes} from "velar/binary"
import {RealtimeFailure, RealtimeFailureAction, RealtimePeer, RealtimePeerState, realtimeSession} from "velar/realtime"
import {WebSocketConnection} from "velar/websocket"

type Command:
    operation: string

type Event:
    event: string

def decode(message: string | Bytes) -> Command:
    if message is string: return {operation: message}
    return {operation: "binary"}

def encode(event: Event) -> string | Bytes: return event.event

async def receive(command: Command, peer: RealtimePeer<Event>):
    await peer.send({event: command.operation})

async def opened(peer: RealtimePeer<Event>) -> (() -> Promise<null>)?:
    assert peer.state() == RealtimePeerState.open
    return async () => null

async def failed(failure: RealtimeFailure, peer: RealtimePeer<Event>):
    await peer.send({event: failure.phase})
    return RealtimeFailureAction.continue

async def serve(connection: WebSocketConnection):
    await realtimeSession(
        connection,
        {decode, encode},
        receive,
        opened=opened,
        failed=failed,
        options={maxQueuedMessages: 8, maxQueuedBytes: 4096, drainTimeout: 2s},
    )
`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /realtimeSession\(/u);
  assert.match(result.code ?? "", /maxQueuedMessages: 8/u);
});

test("server authentication accepts only security credentials and nullable async verifiers", async () => {
  const ordinaryInput = await compileServer(`
import {authenticate} from "velar/server"
import {input} from "velar/serve"

const identity = authenticate(input.header("authorization"), async value => null)
`);
  assert.ok(ordinaryInput.diagnostics.some((item) => /credential must be created by security/u.test(item.message)));

  const synchronous = await compileServer(`
import {authenticate} from "velar/server"
import {security} from "velar/serve"

const identity = authenticate(security.bearer(), token => token)
`);
  assert.ok(synchronous.diagnostics.some((item) => /verify must return a Promise<Identity\?>/u.test(item.message)));

  const nonNullable = await compileServer(`
import {authenticate} from "velar/server"
import {security} from "velar/serve"

const identity = authenticate(security.bearer(), async token => {id: token})
`);
  assert.ok(nonNullable.diagnostics.some((item) => /verify must return an optional identity/u.test(item.message)));
});

test("velar/server exists only when the Server application extension is active", () => {
  assert.equal(nodeModuleInterfaces.has("velar/server"), false);
  assert.equal(serverModuleInterfaces.has("velar/server"), true);
  // realtime 与 websocket 的免复制发送是框架内部所有权交接，不属于应用 API。
  // 运行时模块可以复用它，VelarScript 源码不能导入这条内部 ABI。
  assert.equal(serverModuleInterfaces.get("velar/websocket")?.exports.has("__velarWebSocketSendOwned"), false);
});
