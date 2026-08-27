import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { applyMechanicalFixes, compile, formatSource } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import {nodeModuleInterfaces, velarNodeCompilerExtension, velarProjectExtension} from "@velarscript/node/compiler";
import {serverModuleInterfaces, velarCompilerExtension as velarServerCompilerExtension, velarProjectExtension as serverProjectExtension} from "@velarscript/server/compiler";

function compileNode(source: string) {
  return compile(source.trimStart(), { path: "app.vel", extensions: [velarNodeCompilerExtension] });
}

test("inline RoutePattern captures project directly while 'as' binds the complete match", () => {
  const projected = compileNode(`
server api:
    @get(p"/worlds/{worldId:string}?{details:bool?}") => {worldId, details}
`);
  assert.deepEqual(projected.diagnostics, []);
  assert.match(projected.code ?? "", /async \(\{params:\{worldId\},query:\{details\}\}\) =>/u);

  const bound = compileNode(`
server api:
    @get(p"/worlds/{worldId:string}?{details:bool?}" as route) => {
        pattern: str(route.pattern),
        pathname: route.pathname,
        worldId: route.params.worldId,
        details: route.query.details,
    }
`);
  assert.deepEqual(bound.diagnostics, []);
  assert.match(bound.code ?? "", /async \(route\) =>/u);

  const hidden = compileNode(`
const world = p"/worlds/{worldId:string}"
server api:
    @get(world) => {worldId}
`);
  assert.ok(hidden.diagnostics.some((item) => /cannot introduce hidden names/u.test(item.message)));

  const legacySource = `server api:\n    @get(path=p"/worlds/{worldId:string}") => {worldId: path.params.worldId}\n`;
  const legacy = compileNode(legacySource);
  const positional = legacy.diagnostics.find((item) => /route pattern is positional/u.test(item.message));
  assert.ok(positional?.fix);
  const fixed = applyMechanicalFixes(legacySource, [positional]).text;
  assert.equal(fixed, `server api:\n    @get(p"/worlds/{worldId:string}" as path) => {worldId: path.params.worldId}\n`);
  assert.deepEqual(compileNode(fixed).diagnostics, []);
});

test("@websocket declares one framework-owned connection and shares RoutePattern projection", async () => {
  const result = await compileServer(`
import {WebSocketConnection} from "velar/websocket"

server realtime:
    @websocket(p"/worlds/{worldId:string}/realtime", connection: WebSocketConnection):
        print(worldId)
        await connection.close()
`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCreateServeWebSocket\(/u);
  assert.match(result.code ?? "", /source:"connection",kind:"connection"/u);
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

test("A11 shortens a redundant same-name query mapping without rejecting it", () => {
  const source = `server api:\n    @get(p"/articles?details={details:bool?}" as path) => {details: path.query.details}\n`;
  const result = compileNode(source);
  assert.deepEqual(result.diagnostics, []);
  assert.notEqual(result.code, null, "a canonical-form advisory must not block emission");
  assert.deepEqual(result.advisories.map((item) => item.code), ["A11"]);
  assert.equal(result.advisories[0]?.fix?.title, "Use query shorthand '{details:bool?}'");
  assert.equal(
    applyMechanicalFixes(source, result.advisories).text,
    `server api:\n    @get(p"/articles?{details:bool?}" as path) => {details: path.query.details}\n`,
  );

  const intentionalAlias = compileNode(`server api:\n    @get(p"/articles?include-details={details:bool?}" as path) => {details: path.query.details}\n`);
  const shorthand = compileNode(`server api:\n    @get(p"/articles?{details:bool?}" as path) => {details: path.query.details}\n`);
  assert.deepEqual(intentionalAlias.advisories, []);
  assert.deepEqual(shorthand.advisories, []);
});

async function compileServer(source: string) {
  const path = join(tmpdir(), "velar-server-compile.vel");
  const project = await compileProject(path, new Map([[path, source.trimStart()]]), {extensions: [velarServerCompilerExtension]});
  return project.modules[0]!.result;
}

test("Node application configuration is bounded and rejects unknown fields", () => {
  assert.deepEqual(velarProjectExtension.parse(undefined, "/service/velar.json"), {
    app: "start",
  });
  assert.throws(() => velarProjectExtension.parse({port: 3000}, "/service/velar.json"), /unknown 'node' field 'port'/u);
  assert.throws(() => velarProjectExtension.parse({host: "127.0.0.1"}, "/service/velar.json"), /unknown 'node' field 'host'/u);
  assert.throws(() => velarProjectExtension.parse({maxBodyBytes: 16_777_216}, "/service/velar.json"), /unknown 'node' field 'maxBodyBytes'/u);
  assert.throws(() => velarProjectExtension.parse({workers: 4}, "/service/velar.json"), /unknown 'node' field 'workers'/u);
});

test("server configuration, authentication, and database helpers preserve checked application types", async () => {
  assert.deepEqual(serverProjectExtension.parse(undefined, "/service/velar.json"), {
    app: "start",
  });
  assert.throws(() => serverProjectExtension.parse({port: 3000}, "/service/velar.json"), /unknown 'server' field 'port'/u);
  const source = `
import {application, authenticate, configuration, database} from "velar/server"
import {input, security} from "velar/serve"

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

export const start = application(app)
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
});

test("Node server syntax lowers anonymous async routes without decorator functions", () => {
  const source = `
type CreateUser:
    name: string

type User:
    id: string
    name: string

export server api:
    /// Reports whether the service is ready.
    @get(p"/health" as path) => {ok: true}

    @get(p"/users/{id:number}?{details:bool?}" as path) -> User:
        return {id: str(path.params.id), name: (path.query.details ?? false) ? "full" : "short"}

    @post(p"/users" as path, input: CreateUser):
        return {id: "u1", name: input.name}

    @notFound() => {error: "route_not_found"}
`;
  const result = compileNode(source);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  assert.match(code, /export const api = __velarCreateServeApp\("api"/u);
  assert.match(code, /__velarCreateServeRoute\("GET", __velarCreateServePattern\(\{definition:"\/health"/u);
  assert.match(code, /definition:"\/users\/\{id:number\}\?\{details:bool\?\}"/u);
  assert.match(code, /path:\[\{name:"id"[^\n]*kind:"number"/u);
  assert.match(code, /query:\[\{name:"details"[^\n]*optional:true[^\n]*kind:"bool"/u);
  assert.match(code, /async \(path\)/u);
  assert.match(code, /source:"body",kind:"data"/u);
  assert.match(code, /__velarCreateServeNotFound\(async \(\)/u);
  assert.match(code, /schema:\{"type":"object","properties":\{"name":\{"type":"string"\}\},"required":\["name"\],"additionalProperties":false\}/u);
  assert.match(code, /responseSchema:/u);
  assert.match(code, /description:"Reports whether the service is ready\."/u);
  assert.doesNotMatch(code, /function health|function getUser|function createUser/u);

  const formatted = formatSource(source.trimStart(), { extensions: [velarNodeCompilerExtension] });
  assert.match(formatted, /@get\(p"\/health" as path\) => \{ok: true\}/u);
  assert.match(formatted, /@notFound\(\) => \{error: "route_not_found"\}/u);
  assert.equal(formatSource(formatted, { extensions: [velarNodeCompilerExtension] }), formatted);
});

test("RoutePattern enum captures keep their exact OpenAPI values", () => {
  const result = compileNode(`
enum Visibility:
    public = "published"
    private = "restricted"

server api:
    @get(p"/articles/{visibility:Visibility}?{filter:Visibility?}" as path) => {
        visibility: path.params.visibility,
        filter: path.query.filter,
    }
`);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  assert.match(code, /name:"visibility"[^\n]*schema:\{"type":"string","enum":\["published","restricted"\]\}/u);
  assert.match(code, /name:"filter"[^\n]*schema:\{"type":"string","enum":\["published","restricted"\]\}/u);
});

test("RoutePattern scalar aliases keep their decoded runtime kinds", () => {
  const result = compileNode(`
type Identifier = number
type Enabled = bool

server api:
    @get(p"/articles/{id:Identifier}?{enabled:Enabled}" as path) => {
        id: path.params.id,
        enabled: path.query.enabled,
    }
`);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  assert.match(code, /name:"id"[^\n]*kind:"number"[^\n]*schema:\{"type":"number"\}/u);
  assert.match(code, /name:"enabled"[^\n]*kind:"bool"[^\n]*schema:\{"type":"boolean"\}/u);
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

test("Node server diagnostics keep route contracts static and unambiguous", async () => {
  const source = `
type Body:
    value: string

server invalid:
    @get(p"/users/{id:Body}" as path, query: Body):
        return {ok: true}

    @get(p"/users/{name:string}" as path):
        return {ok: true}

    @post(p"/items" as path, first: Body, second: Body):
        return {ok: true}

    @post(p"/untyped" as path, input):
        return {ok: true}
`;
  const messages = compileNode(source).diagnostics.map((item) => item.message);
  assert.ok(messages.some((message) => /GET routes do not infer a JSON body/u.test(message)));
  assert.ok(messages.some((message) => /Route field 'id' must be string, number, bool, or an enum/u.test(message)));
  assert.ok(messages.some((message) => /conflicts with 'GET \/users\/\{id:Body\}'/u.test(message)));
  assert.ok(messages.some((message) => /only one structured JSON body/u.test(message)));
  assert.ok(messages.some((message) => /requires an explicit type/u.test(message)));
  assert.ok(messages.every((message) => !/matching '.*: Type' declaration/u.test(message)));
  const unknown = compileNode(`server api:\n    @head(p"/unsupported") => {ok: true}\n`);
  assert.ok(unknown.diagnostics.some((item) => /Unknown compiler-owned name '@head'/u.test(item.message)));
  const wildcard = compileNode(`server api:\n    @get(p"/files/*" as path) => {ok: true}\n`);
  assert.ok(wildcard.diagnostics.some((item) => /use staticFiles/u.test(item.message)));
  const requestPath = join(tmpdir(), "velar-node-server-request-diagnostic.vel");
  const requestProject = await compileProject(requestPath, new Map([[requestPath, `
import {Request} from "velar/serve"

server api:
    @get(p"/request" as path, first: Request, second: Request) => {ok: true}
    @notFound(request: Request) => {error: "missing", path: request.path}
`.trimStart()]]), { extensions: [velarNodeCompilerExtension] });
  const requestDiagnostics = requestProject.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(requestDiagnostics.some((item) => /only one Request parameter/u.test(item.message)));
  assert.ok(requestDiagnostics.every((item) => !/@notFound/u.test(item.message)));

  const fallbackPath = join(tmpdir(), "velar-node-server-fallback.vel");
  const fallbackProject = await compileProject(fallbackPath, new Map([[fallbackPath, `
import {Request} from "velar/serve"

server api:
    @notFound(request: Request) => {error: "missing", path: request.path}
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(fallbackProject.failures, []);
  assert.deepEqual(fallbackProject.modules.flatMap((module) => module.result.diagnostics), []);
  assert.match(fallbackProject.modules.find((module) => module.inputPath === fallbackPath)?.result.code ?? "", /__velarCreateServeNotFound\(async \(request\)/u);

  const duplicateFallback = compileNode(`
server api:
    @notFound() => {error: "missing"}
    @notFound() => {error: "still_missing"}
`);
  const fallbackMessages = duplicateFallback.diagnostics.map((item) => item.message);
  assert.ok(fallbackMessages.some((message) => /only one @notFound fallback/u.test(message)));

  const invalidFallback = compileNode(`
server api:
    @notFound(request) => {error: "missing"}
`);
  assert.ok(invalidFallback.diagnostics.some((item) => /requires the explicit Request type/u.test(item.message)));

  const wrongFallback = compileNode(`
server api:
    @notFound(path: string) => {error: "missing", path}
`);
  assert.ok(wrongFallback.diagnostics.some((item) => /parameter must be Request/u.test(item.message)));

  const scopedPolicies = compileNode(`
import {HttpOutcome, prefix} from "velar/serve"

server child:
    @get(p"/health" as path) => {ok: true}
    @notFound() => {error: "missing"}
    @response(outcome: HttpOutcome) => {ok: outcome.ok}

server api:
    ...prefix("/api", child)
`);
  const scopedMessages = scopedPolicies.diagnostics.map((item) => item.message);
  assert.ok(scopedMessages.some((message) => /prefix cannot scope @notFound/u.test(message)));
  assert.ok(scopedMessages.some((message) => /prefix cannot scope @response/u.test(message)));

  const tooManyQueryFields = Array.from({length: 65}, (_value, index) => `{field${index}:string}`).join("&");
  const bounded = compileNode(`server api:\n    @get(p"/items?${tooManyQueryFields}" as path) => {ok: true}\n`);
  assert.ok(bounded.diagnostics.some((item) => /more than 64 query fields/u.test(item.message)));

  const longWireName = "q".repeat(257);
  const longWire = compileNode(`server api:\n    @get(p"/items?${longWireName}={value:string}" as path) => {ok: true}\n`);
  assert.ok(longWire.diagnostics.some((item) => /wire name cannot exceed 256/u.test(item.message)));

  const longPath = compileNode(`server api:\n    @get(p"/${" as pathx".repeat(4096)}") => {ok: true}\n`);
  assert.ok(longPath.diagnostics.some((item) => /1 through 4096 code units/u.test(item.message)));
});

test("Routes that share a path without a more specific winner are rejected", () => {
  const ambiguous = compileNode(`
server api:
    @get(p"/a/{x:string}/b" as path) => {ok: true}
    @get(p"/a/b/{y:string}" as path) => {ok: true}
`);
  assert.deepEqual(ambiguous.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  const captures = compileNode(`
server api:
    @get(p"/a/{x:string}/b/{p:string}" as path) => {ok: true}
    @get(p"/a/b/{y:string}/{q:string}" as path) => {ok: true}
`);
  assert.deepEqual(captures.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b/{p:string}' overlaps 'GET /a/b/{y:string}/{q:string}'; both match '/a/b/b/p' and neither is more specific — narrow or remove one",
  ]);

  const specific = compileNode(`
server api:
    @get(p"/users/me" as path) => {ok: true}
    @get(p"/users/{id:string}" as path) => {ok: true}
    @get(p"/users/{id:string}/settings" as path) => {ok: true}
    @get(p"/users/{id:string}/{section:string}" as path) => {ok: true}
`);
  assert.deepEqual(specific.diagnostics, []);

  const unrealizable = compileNode(`
server api:
    @get(p"/a/{n:number}/b" as path) => {ok: true}
    @get(p"/a/b/{m:string}" as path) => {ok: true}
    @get(p"/a/{f:bool}/c" as path) => {ok: true}
    @get(p"/a/c/{m:string}" as path) => {ok: true}
`);
  assert.deepEqual(unrealizable.diagnostics, []);

  const separate = compileNode(`
server api:
    @get(p"/a/{x:string}" as path) => {ok: true}
    @get(p"/a/b/{y:string}" as path) => {ok: true}
    @post(p"/a/{x:string}/b" as path) => {ok: true}
    @get(p"/a/true/{y:string}" as path) => {ok: true}
`);
  assert.deepEqual(separate.diagnostics.map((item) => item.message), []);
});

test("A statically resolvable spread enters the composing server's route checks", async () => {
  const composed = (order: string) => compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

server app:
${order}
`).diagnostics.map((item) => item.message);

  // The spread wins or loses by written position at runtime, so both orders must report.
  assert.deepEqual(composed(`    ...base
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}`), [
    "Route 'GET /a/{x:string}/b' (composed in from 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);
  assert.deepEqual(composed(`    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
    ...base`), [
    "Route 'GET /a/b/{y:string}' overlaps 'GET /a/{x:string}/b' (composed in from 'base'); both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  const duplicate = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

server app:
    ...base
    @get(p"/a/{z:string}/b" as path) => {ok: "right"}
`);
  assert.deepEqual(duplicate.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{z:string}/b' conflicts with 'GET /a/{x:string}/b' (composed in from 'base'); parameter names do not make two route shapes distinct",
  ]);

  const fallback = compileNode(`
server base:
    @notFound() => {error: "missing"}

server app:
    ...base
    @notFound() => {error: "still_missing"}
`);
  assert.deepEqual(fallback.diagnostics.map((item) => item.message), [
    "A server can declare only one @notFound fallback; 'base' composes one in and this server declares another",
  ]);

  const transitive = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

server mid:
    ...base

server app:
    ...mid
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`);
  assert.deepEqual(transitive.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' (composed in from 'mid' → 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  // The composed server already reported the pair; the server that spreads it must not repeat it.
  const reported = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}

server app:
    ...base
`);
  assert.equal(reported.diagnostics.length, 1);

  const aliased = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

const one = base
const two = one

server app:
    ...two
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`);
  assert.deepEqual(aliased.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' (composed in from 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);
});

test("A composition collision names its own cause, not the nearest one", () => {
  // Composing one server twice is what __velarCreateServeApp rejects as a conflicting route: the
  // same declaration is appended twice. Neither side has a parameter name to blame and neither can
  // be narrowed, so the message names the server that arrives twice and the spreads that carry it.
  const twice = compileNode(`
server base:
    @get(p"/a/{x:string}" as path) => {ok: "left"}

server app:
    ...base
    ...base
`);
  assert.deepEqual(twice.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}' is composed in twice, both times from 'base'; 'base' declares it once — remove one spread",
  ]);

  const diamond = compileNode(`
server base:
    @get(p"/a/{x:string}" as path) => {ok: "left"}

server mid1:
    ...base

server mid2:
    ...base

server app:
    ...mid1
    ...mid2
`);
  assert.deepEqual(diamond.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}' is composed in twice, from 'mid1' → 'base' and from 'mid2' → 'base'; 'base' declares it once — remove one spread",
  ]);

  // Two routes spelling one path collide over the path itself; parameter names are not the cause
  // and naming them sends the author looking for a difference that is not there.
  const composedPath = compileNode(`
server one:
    @get(p"/a" as path) => {ok: 1}

server two:
    @get(p"/a" as path) => {ok: 2}

server app:
    ...one
    ...two
`);
  assert.deepEqual(composedPath.diagnostics.map((item) => item.message), [
    "Route 'GET /a' (composed in from 'two') duplicates 'GET /a' (composed in from 'one'); one method and path answer from a single route",
  ]);

  const writtenPath = compileNode(`
server api:
    @get(p"/a" as path) => {ok: 1}
    @get(p"/a" as path) => {ok: 2}
`);
  assert.deepEqual(writtenPath.diagnostics.map((item) => item.message), [
    "Route 'GET /a' duplicates 'GET /a'; one method and path answer from a single route",
  ]);

  // Both @notFound contributors are named, whichever side is written here.
  const bothComposed = compileNode(`
server one:
    @notFound() => {error: "one"}

server two:
    @notFound() => {error: "two"}

server app:
    ...one
    ...two
`);
  assert.deepEqual(bothComposed.diagnostics.map((item) => item.message), [
    "A server can declare only one @notFound fallback; 'one' composes one in and 'two' composes another in",
  ]);

  const writtenFirst = compileNode(`
server base:
    @notFound() => {error: "base"}

server app:
    @notFound() => {error: "app"}
    ...base
`);
  assert.deepEqual(writtenFirst.diagnostics.map((item) => item.message), [
    "A server can declare only one @notFound fallback; this server declares one and 'base' composes another in",
  ]);

  const writtenTwice = compileNode(`
server api:
    @notFound() => {error: "a"}
    @notFound() => {error: "b"}
`);
  assert.deepEqual(writtenTwice.diagnostics.map((item) => item.message), [
    "A server can declare only one @notFound fallback",
  ]);
});

test("Spread route checking stays inside what one module can resolve", async () => {
  // A cycle is not a program the runtime can build, but it must not be reported as a route
  // conflicting with itself either.
  const cycle = compileNode(`
server a:
    ...b
    @get(p"/x" as path) => {ok: true}

server b:
    ...a
    @get(p"/y" as path) => {ok: true}
`);
  assert.deepEqual(cycle.diagnostics.map((item) => item.message), []);

  // A `let` alias the module never reassigns holds its initializer exactly as a `const` does, so
  // the stability predicate lets it resolve and the genuine overlap is reported (D90 R19).
  const stableAlias = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

let other = base

server app:
    ...other
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`);
  assert.deepEqual(stableAlias.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' (composed in from 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  // A `let` that is actually reassigned contributes nothing: which server it holds depends on
  // execution order, and the assembly-time referee owns that question.
  const rebound = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

server extra:
    @get(p"/c" as path) => {ok: true}

let other = base
other = extra

server app:
    ...other
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`);
  assert.deepEqual(rebound.diagnostics.map((item) => item.message), []);

  const distinct = compileNode(`
server base:
    @get(p"/users/me" as path) => {ok: true}

server app:
    ...base
    @get(p"/users/{id:string}" as path) => {ok: true}
    @post(p"/users/me" as path) => {ok: true}
`);
  assert.deepEqual(distinct.diagnostics.map((item) => item.message), []);

  // An imported server is a value this analyzer cannot see into. A prefix(...) call is now seen
  // through (D90 R19), but its app argument here is that same import, so both spreads stay
  // conservatively unchecked even where the composed routes would overlap the local ones — the
  // assembly-time referee owns them.
  const root = join(tmpdir(), "velar-node-server-spread-boundary");
  const users = join(root, "users.vel");
  const app = join(root, "app.vel");
  const project = await compileProject(app, new Map([
    [users, `
export server users:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}
`.trimStart()],
    [app, `
import {prefix} from "velar/serve"
import {users} from "./users.vel"

export server direct:
    ...users
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}

export server scoped:
    ...prefix("/api", users)
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`.trimStart()],
  ]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
});

test("Node owns and validates path-pattern strings without changing Core strings", () => {
  const fullWidth = compileNode(`server api:\n    @get(p"/articles/{id：string}" as path) => {ok: true}\n`);
  assert.ok(fullWidth.diagnostics.some((item) => /declares its field and type/u.test(item.message)));

  const plain = compileNode(`server api:\n    @get(path="/articles/{id:string}") => {ok: true}\n`);
  assert.ok(plain.diagnostics.some((item) => /route pattern is positional/u.test(item.message)));

  const core = compile(`const path = p"/articles/{id:string}"\n`, { path: "core.vel" });
  assert.ok(core.diagnostics.length > 0);
});

test("Node servers preserve their nominal contract across modules and composition", async () => {
  const root = join(tmpdir(), "velar-node-server-modules");
  const users = join(root, "users.vel");
  const app = join(root, "app.vel");
  const main = join(root, "main.vel");
  const project = await compileProject(main, new Map([
    [users, `
export server users:
    @get(p"/{id:string}" as path) => {id: path.params.id}
`.trimStart()],
    [app, `
import {prefix} from "velar/serve"
import {users} from "./users.vel"

export server app:
    ...prefix("/api/users", users)
`.trimStart()],
    [main, `
import {serve} from "velar/serve"
import {app} from "./app.vel"

await serve(app, port=3000)
`.trimStart()],
  ]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.match(project.modules.find((module) => module.inputPath === app)?.result.code ?? "", /prefix\("\/api\/users", users\)/u);
});

test("compiler-owned route names are not decorators or top-level values", () => {
  const result = compileNode(`
@get(p"/health" as path)
def health():
    return {ok: true}
`);
  assert.ok(result.diagnostics.some((item) => /valid only directly inside a server block/u.test(item.message)));
});

test("route input values infer handler parameters and provider results", async () => {
  const path = join(tmpdir(), "velar-node-route-input-values.vel");
  const project = await compileProject(path, new Map([[path, `
import {input, provide, security} from "velar/serve"

type User:
    id: string

type UploadMetadata:
    title: string

async def authenticate(token: string) -> User:
    return {id: token}

const currentUser = provide(
    inputs={token: security.bearer()},
    resolve=async values => await authenticate(values.token),
)

server api:
    @get(p"/users/me" as path,
        user=input.dependency(currentUser),
        session=input.cookie("session", default=null),
    ) => {id: user.id, session}

    @post(p"/files" as path,
        metadata=input.form(UploadMetadata),
        image=input.upload("image", maxBytes=8_388_608),
    ) => {title: metadata.title, filename: image.filename}
`.trimStart()]]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const code = project.modules[0]?.result.code ?? "";
  assert.match(code, /source:"dependency",kind:"dependency"[^\n]*input:input\.dependency\(currentUser\)/u);
  assert.match(code, /source:"cookie",kind:"string"[^\n]*input:input\.cookie\([^\n]*"session", null/u);
  assert.match(code, /async \(path, user, session\)/u);
  assert.doesNotMatch(code, /async \(user = input\.dependency/u);
  assert.match(code, /source:"form",kind:"data"/u);
  assert.match(code, /source:"upload",kind:"upload"/u);
});

test("response helpers preserve compiler-derived OpenAPI schemas and final statuses", async () => {
  const path = join(tmpdir(), "velar-node-response-openapi.vel");
  const project = await compileProject(path, new Map([[path, `
import {background, created, json, noContent, setCookie} from "velar/serve"

type Article:
    title: string

server api:
    @post(p"/articles" as path, input: Article) => setCookie(background(created(input), async () => null), "created", "yes")
    @put(p"/articles/{id:string}" as path, input: Article) => json(input, status=202)
    @delete(p"/articles/{id:string}" as path) => noContent()
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const code = project.modules[0]?.result.code ?? "";
  assert.match(code, /responseSchema:\{"type":"object","properties":\{"title":\{"type":"string"\}\},"required":\["title"\],"additionalProperties":false\},responseContentTypes:\["application\/json"\],status:201/u);
  assert.match(code, /responseContentTypes:\["application\/json"\],status:202/u);
  assert.match(code, /status:204/u);
});

test("a data record named status remains a JSON OpenAPI response", async () => {
  const path = join(tmpdir(), "velar-node-response-status-field.vel");
  const project = await compileProject(path, new Map([[path, `
server api:
    @get(p"/health" as path) => {status: "ready", service: "openvoxel"}
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const code = project.modules[0]?.result.code ?? "";
  assert.match(code, /responseSchema:\{"type":"object","properties":\{"status":\{"type":"string"\},"service":\{"type":"string"\}\},"required":\["status","service"\],"additionalProperties":false\},responseContentTypes:\["application\/json"\]/u);
  assert.doesNotMatch(code, /responseContentTypes:\["application\/octet-stream"\]/u);
});

test("velar/server-test is available only to test modules", async () => {
  const root = join(tmpdir(), "velar-node-server-test-boundary");
  const application = join(root, "app.vel");
  const forbidden = await compileProject(application, new Map([[application, `import {client} from "velar/server-test"\nconst value = client\n`]]), {extensions: [velarNodeCompilerExtension]});
  assert.ok(forbidden.modules.flatMap((module) => module.result.diagnostics).some((item) => /only from a '\*\.test\.vel' module/u.test(item.message)));

  const testPath = join(root, "app.test.vel");
  const allowed = await compileProject(testPath, new Map([[testPath, `
import {client} from "velar/server-test"
import {ServeApp} from "velar/serve"

async def open(app: ServeApp):
    const testClient = await client(app)
    await testClient.close()
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(allowed.failures, []);
  assert.deepEqual(allowed.modules.flatMap((module) => module.result.diagnostics), []);
});
