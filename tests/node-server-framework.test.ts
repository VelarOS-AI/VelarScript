import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { compile, formatSource } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { velarNodeCompilerExtension, velarProjectExtension } from "@velarscript/node/compiler";

function compileNode(source: string) {
  return compile(source.trimStart(), { path: "app.vel", extensions: [velarNodeCompilerExtension] });
}

test("Node application configuration is bounded and rejects unknown fields", () => {
  assert.deepEqual(velarProjectExtension.parse(undefined, "/service/velar.json"), {
    app: "app",
    host: "127.0.0.1",
    port: 3000,
    maxBodyBytes: 16_777_216,
    build: {sourceMaps: false},
  });
  assert.throws(() => velarProjectExtension.parse({port: 0}, "/service/velar.json"), /node\.port.*1 through 65535/u);
  assert.throws(() => velarProjectExtension.parse({maxBodyBytes: 16_777_217}, "/service/velar.json"), /node\.maxBodyBytes/u);
  assert.throws(() => velarProjectExtension.parse({workers: 4}, "/service/velar.json"), /unknown 'node' field 'workers'/u);
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
    @get(p"/health") => {ok: true}

    @get(p"/users/{id:number}", details: bool = false) -> User:
        return {id: str(id), name: details ? "full" : "short"}

    @post(p"/users", input: CreateUser):
        return {id: "u1", name: input.name}

    @notFound() => {error: "route_not_found"}
`;
  const result = compileNode(source);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  assert.match(code, /export const api = __velarCreateServeApp\("api"/u);
  assert.match(code, /__velarCreateServeRoute\("GET", "\/health", \[\], async \(\)/u);
  assert.match(code, /__velarCreateServeRoute\("GET", "\/users\/\{id:number\}"/u);
  assert.match(code, /source:"path",kind:"number"/u);
  assert.match(code, /source:"query",kind:"bool",required:false/u);
  assert.match(code, /source:"body",kind:"data"/u);
  assert.match(code, /__velarCreateServeNotFound\(async \(\)/u);
  assert.match(code, /schema:\{"type":"object","properties":\{"name":\{"type":"string"\}\},"required":\["name"\],"additionalProperties":false\}/u);
  assert.match(code, /responseSchema:/u);
  assert.match(code, /description:"Reports whether the service is ready\."/u);
  assert.doesNotMatch(code, /function health|function getUser|function createUser/u);

  const formatted = formatSource(source.trimStart(), { extensions: [velarNodeCompilerExtension] });
  assert.match(formatted, /@get\(p"\/health"\) => \{ok: true\}/u);
  assert.match(formatted, /@notFound\(\) => \{error: "route_not_found"\}/u);
  assert.equal(formatSource(formatted, { extensions: [velarNodeCompilerExtension] }), formatted);
});

test("Node server diagnostics keep route contracts static and unambiguous", async () => {
  const source = `
type Body:
    value: string

server invalid:
    @get(p"/users/{id:Body}", query: Body):
        return {ok: true}

    @get(p"/users/{name:string}"):
        return {ok: true}

    @post(p"/items", first: Body, second: Body):
        return {ok: true}

    @post(p"/untyped", input):
        return {ok: true}
`;
  const messages = compileNode(source).diagnostics.map((item) => item.message);
  assert.ok(messages.some((message) => /GET routes do not infer a JSON body/u.test(message)));
  assert.ok(messages.some((message) => /Path parameter 'id' must be string, number, bool, or an enum/u.test(message)));
  assert.ok(messages.some((message) => /conflicts with 'GET \/users\/\{id:Body\}'/u.test(message)));
  assert.ok(messages.some((message) => /only one structured JSON body/u.test(message)));
  assert.ok(messages.some((message) => /requires an explicit type/u.test(message)));
  assert.ok(messages.every((message) => !/matching '.*: Type' declaration/u.test(message)));
  const unknown = compileNode(`server api:\n    @head(p"/unsupported") => {ok: true}\n`);
  assert.ok(unknown.diagnostics.some((item) => /Unknown compiler-owned name '@head'/u.test(item.message)));
  const wildcard = compileNode(`server api:\n    @get(p"/files/*") => {ok: true}\n`);
  assert.ok(wildcard.diagnostics.some((item) => /compose staticFiles/u.test(item.message)));
  const requestPath = join(tmpdir(), "velar-node-server-request-diagnostic.vel");
  const requestProject = await compileProject(requestPath, new Map([[requestPath, `
import {Request} from "velar/serve"

server api:
    @get(p"/request", first: Request, second: Request) => {ok: true}
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
});

test("Routes that share a path without a more specific winner are rejected", () => {
  const ambiguous = compileNode(`
server api:
    @get(p"/a/{x:string}/b") => {ok: true}
    @get(p"/a/b/{y:string}") => {ok: true}
`);
  assert.deepEqual(ambiguous.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  const captures = compileNode(`
server api:
    @get(p"/a/{x:string}/b/{p:string}") => {ok: true}
    @get(p"/a/b/{y:string}/{q:string}") => {ok: true}
`);
  assert.deepEqual(captures.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b/{p:string}' overlaps 'GET /a/b/{y:string}/{q:string}'; both match '/a/b/b/p' and neither is more specific — narrow or remove one",
  ]);

  const specific = compileNode(`
server api:
    @get(p"/users/me") => {ok: true}
    @get(p"/users/{id:string}") => {ok: true}
    @get(p"/users/{id:string}/settings") => {ok: true}
    @get(p"/users/{id:string}/{section:string}") => {ok: true}
`);
  assert.deepEqual(specific.diagnostics, []);

  const unrealizable = compileNode(`
server api:
    @get(p"/a/{n:number}/b") => {ok: true}
    @get(p"/a/b/{m:string}") => {ok: true}
    @get(p"/a/{f:bool}/c") => {ok: true}
    @get(p"/a/c/{m:string}") => {ok: true}
`);
  assert.deepEqual(unrealizable.diagnostics, []);

  const separate = compileNode(`
server api:
    @get(p"/a/{x:string}") => {ok: true}
    @get(p"/a/b/{y:string}") => {ok: true}
    @post(p"/a/{x:string}/b") => {ok: true}
    @get(p"/a/true/{y:string}") => {ok: true}
`);
  assert.deepEqual(separate.diagnostics.map((item) => item.message), []);
});

test("A statically resolvable spread enters the composing server's route checks", async () => {
  const composed = (order: string) => compileNode(`
server base:
    @get(p"/a/{x:string}/b") => {ok: "left"}

server app:
${order}
`).diagnostics.map((item) => item.message);

  // The spread wins or loses by written position at runtime, so both orders must report.
  assert.deepEqual(composed(`    ...base
    @get(p"/a/b/{y:string}") => {ok: "right"}`), [
    "Route 'GET /a/{x:string}/b' (composed in from 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);
  assert.deepEqual(composed(`    @get(p"/a/b/{y:string}") => {ok: "right"}
    ...base`), [
    "Route 'GET /a/b/{y:string}' overlaps 'GET /a/{x:string}/b' (composed in from 'base'); both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  const duplicate = compileNode(`
server base:
    @get(p"/a/{x:string}/b") => {ok: "left"}

server app:
    ...base
    @get(p"/a/{z:string}/b") => {ok: "right"}
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
    @get(p"/a/{x:string}/b") => {ok: "left"}

server mid:
    ...base

server app:
    ...mid
    @get(p"/a/b/{y:string}") => {ok: "right"}
`);
  assert.deepEqual(transitive.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' (composed in from 'mid' → 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  // The composed server already reported the pair; the server that spreads it must not repeat it.
  const reported = compileNode(`
server base:
    @get(p"/a/{x:string}/b") => {ok: "left"}
    @get(p"/a/b/{y:string}") => {ok: "right"}

server app:
    ...base
`);
  assert.equal(reported.diagnostics.length, 1);

  const aliased = compileNode(`
server base:
    @get(p"/a/{x:string}/b") => {ok: "left"}

const one = base
const two = one

server app:
    ...two
    @get(p"/a/b/{y:string}") => {ok: "right"}
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
    @get(p"/a/{x:string}") => {ok: "left"}

server app:
    ...base
    ...base
`);
  assert.deepEqual(twice.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}' is composed in twice, both times from 'base'; 'base' declares it once — remove one spread",
  ]);

  const diamond = compileNode(`
server base:
    @get(p"/a/{x:string}") => {ok: "left"}

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
    @get(p"/a") => {ok: 1}

server two:
    @get(p"/a") => {ok: 2}

server app:
    ...one
    ...two
`);
  assert.deepEqual(composedPath.diagnostics.map((item) => item.message), [
    "Route 'GET /a' (composed in from 'two') duplicates 'GET /a' (composed in from 'one'); one method and path answer from a single route",
  ]);

  const writtenPath = compileNode(`
server api:
    @get(p"/a") => {ok: 1}
    @get(p"/a") => {ok: 2}
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
    @get(p"/x") => {ok: true}

server b:
    ...a
    @get(p"/y") => {ok: true}
`);
  assert.deepEqual(cycle.diagnostics.map((item) => item.message), []);

  // A `let` alias the module never reassigns holds its initializer exactly as a `const` does, so
  // the stability predicate lets it resolve and the genuine overlap is reported (D90 R19).
  const stableAlias = compileNode(`
server base:
    @get(p"/a/{x:string}/b") => {ok: "left"}

let other = base

server app:
    ...other
    @get(p"/a/b/{y:string}") => {ok: "right"}
`);
  assert.deepEqual(stableAlias.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' (composed in from 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  // A `let` that is actually reassigned contributes nothing: which server it holds depends on
  // execution order, and the assembly-time referee owns that question.
  const rebound = compileNode(`
server base:
    @get(p"/a/{x:string}/b") => {ok: "left"}

server extra:
    @get(p"/c") => {ok: true}

let other = base
other = extra

server app:
    ...other
    @get(p"/a/b/{y:string}") => {ok: "right"}
`);
  assert.deepEqual(rebound.diagnostics.map((item) => item.message), []);

  const distinct = compileNode(`
server base:
    @get(p"/users/me") => {ok: true}

server app:
    ...base
    @get(p"/users/{id:string}") => {ok: true}
    @post(p"/users/me") => {ok: true}
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
    @get(p"/a/{x:string}/b") => {ok: "left"}
`.trimStart()],
    [app, `
import {prefix} from "velar/serve"
import {users} from "./users.vel"

export server direct:
    ...users
    @get(p"/a/b/{y:string}") => {ok: "right"}

export server scoped:
    ...prefix("/api", users)
    @get(p"/a/b/{y:string}") => {ok: "right"}
`.trimStart()],
  ]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
});

test("Node owns and validates path-pattern strings without changing Core strings", () => {
  const fullWidth = compileNode(`server api:\n    @get(p"/articles/{id：string}") => {id}\n`);
  const separator = fullWidth.diagnostics.find((item) => /half-width ':'/u.test(item.message));
  assert.equal(separator?.fix?.edits[0]?.text, ":");

  const plain = compileNode(`server api:\n    @get("/articles/{id:string}") => {id}\n`);
  assert.ok(plain.diagnostics.some((item) => /must be a Node path pattern/u.test(item.message)));

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
    @get(p"/{id:string}") => {id}
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
@get(p"/health")
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
    @get(p"/users/me",
        user=input.dependency(currentUser),
        session=input.cookie("session", default=null),
    ) => {id: user.id, session}

    @post(p"/files",
        metadata=input.form(UploadMetadata),
        image=input.upload("image", maxBytes=8_388_608),
    ) => {title: metadata.title, filename: image.filename}
`.trimStart()]]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const code = project.modules[0]?.result.code ?? "";
  assert.match(code, /source:"dependency",kind:"dependency"[^\n]*input:input\.dependency\(currentUser\)/u);
  assert.match(code, /source:"cookie",kind:"string"[^\n]*input:input\.cookie\([^\n]*"session", null/u);
  assert.match(code, /async \(user, session\)/u);
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
    @post(p"/articles", input: Article) => setCookie(background(created(input), async () => null), "created", "yes")
    @put(p"/articles/{id:string}", input: Article) => json(input, status=202)
    @delete(p"/articles/{id:string}") => noContent()
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const code = project.modules[0]?.result.code ?? "";
  assert.match(code, /responseSchema:\{"type":"object","properties":\{"title":\{"type":"string"\}\},"required":\["title"\],"additionalProperties":false\},responseContentTypes:\["application\/json"\],status:201/u);
  assert.match(code, /responseContentTypes:\["application\/json"\],status:202/u);
  assert.match(code, /responseContentTypes:\["text\/plain"\],status:204/u);
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
